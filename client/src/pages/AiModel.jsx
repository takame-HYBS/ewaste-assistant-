import { useState } from 'react';
import { api, getToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ACTION_LABEL, Button, Card, Empty, ErrorText, Loading, Notice, Page, dateText, useLoad } from '../ui.jsx';

const pct = (x, d = 1) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(d)}%`);
const ACTIONS = ['reuse', 'repair', 'donate', 'parts_recovery', 'recycle'];

function Bars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span>{r.label}</span>
          <span className="h-3 rounded-sm bg-paper" aria-hidden="true">
            <span className="block h-3 rounded-sm bg-board" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-semibold">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ value, label }) {
  return (
    <div className="rounded-md border border-line bg-card p-4">
      <p className="font-display text-3xl font-bold text-board-dark">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

function ComparisonTable({ title, set }) {
  return (
    <div>
      <h3 className="mb-1 font-bold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr><th className="py-2">Method</th><th>Accuracy</th><th>Macro F1</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr className="font-semibold">
              <td className="py-2">AI model</td>
              <td>{pct(set.model.accuracy)}{set.model.accuracyCI95 ? <span className="font-normal text-muted"> (95% CI {pct(set.model.accuracyCI95[0], 0)} to {pct(set.model.accuracyCI95[1], 0)})</span> : null}</td>
              <td>{pct(set.model.macroF1)}</td>
            </tr>
            <tr><td className="py-2">Rule engine alone</td><td>{pct(set.rules.accuracy)}</td><td>{pct(set.rules.macroF1)}</td></tr>
            <tr><td className="py-2">Always guess “{ACTION_LABEL[set.majorityBaseline.majority]}”</td><td>{pct(set.majorityBaseline.accuracy)}</td><td>n/a</td></tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-sm text-muted">{set.model.n} cases</p>
    </div>
  );
}

function Confusion({ cm }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-center text-sm">
        <caption className="mb-1 text-left text-sm text-muted">Rows are the correct action. Columns are what the AI chose. Numbers on the diagonal are correct.</caption>
        <thead>
          <tr className="border-b border-line text-muted">
            <th scope="col" className="py-2 text-left">Correct \ AI chose</th>
            {cm.classes.map((c) => <th scope="col" key={c}>{ACTION_LABEL[c]}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {cm.classes.map((c, i) => (
            <tr key={c}>
              <th scope="row" className="py-2 text-left">{ACTION_LABEL[c]}</th>
              {cm.matrix[i].map((n, j) => <td key={j} className={i === j ? 'font-bold text-board-dark' : 'text-muted'}>{n}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Offline({ model }) {
  const ev = model.evaluation;
  const h = ev.heldOutSynthetic;
  return (
    <Card>
      <h2 className="mb-1 text-xl font-bold">How accurate is it?</h2>
      <p className="mb-4 text-sm text-muted">
        Tested on cases the model never saw during training. Algorithm: {model.algorithm.toLowerCase()}, using {model.features} features. Model version {model.version}, trained {dateText(model.trainedAt)}.
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <ComparisonTable title="Held-out test cases" set={h} />
        <ComparisonTable title="Hand-written gold cases" set={ev.goldHandWritten} />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat value={pct(h.model.top2Accuracy)} label="Correct action is in the AI's top two choices" />
        <Stat value={h.model.repairDecision.auc.toFixed(2)} label='Repair decision AUC ("is repair best?", 1.0 is perfect)' />
        <Stat value={pct(h.model.calibration.ece)} label="Calibration error (how far stated confidence is from reality, lower is better)" />
      </div>

      <h3 className="mb-1 mt-6 font-bold">Where it gets confused</h3>
      <Confusion cm={h.model.confusion} />

      <div className="mt-5">
        <Notice kind="warn">
          <strong>Read this before quoting the numbers. </strong>
          No public dataset of repair-or-recycle decisions exists, so the model was trained on {model.training.syntheticCases.toLocaleString()} synthetic cases labelled by a simulated panel of three decision styles, and the
          hand-written set has only {model.training.goldCases} cases. These scores show the model reproduces sensible decisions on unseen cases. They do not yet prove real-world
          accuracy. That is what the user ratings below and the export of real cases are for. The three simulated experts agree with each other on only {pct(h.expertPanel.meanPairwiseAgreement, 0)} of cases, so these decisions are
          genuinely ambiguous. “Parts recovery” is the hardest action to predict.
        </Notice>
      </div>
    </Card>
  );
}

function Live({ u }) {
  const fb = u.feedback;
  return (
    <Card>
      <h2 className="mb-1 text-xl font-bold">Is it useful to people?</h2>
      <p className="mb-4 text-sm text-muted">Live results from users of this app. Every recommendation asks for a rating and whether the person will follow it.</p>
      {fb.n === 0 ? (
        <Empty>No ratings yet. Get a recommendation for a device and rate it, and the numbers will appear here.</Empty>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat value={fb.n} label="Ratings received" />
            <Stat value={`${fb.averageRating} / 5`} label="Average helpfulness" />
            <Stat value={pct(fb.shareRated4or5, 0)} label="Rated it 4 or 5" />
            <Stat value={pct(fb.willFollowYesOrPartlyRate, 0)} label="Will follow it (fully or partly)" />
          </div>
          <div className="mt-5 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 font-bold">Ratings</h3>
              <Bars rows={[5, 4, 3, 2, 1].map((n) => ({ label: `${n} star${n > 1 ? 's' : ''}`, value: fb.ratings[n] }))} />
            </div>
            <div>
              <h3 className="mb-2 font-bold">Will they follow it?</h3>
              <Bars rows={[['yes', 'Yes'], ['partly', 'Partly'], ['no', 'No']].map(([k, label]) => ({ label, value: fb.willFollow[k] }))} />
            </div>
          </div>
        </>
      )}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat value={u.recommendationsWithAi} label="Recommendations made with the AI" />
        <Stat value={pct(u.aiAgreesWithRules.rate, 0)} label={`AI agrees with the rule check (${u.aiAgreesWithRules.n} cases)`} />
        <Stat value={pct(u.completedMatchesRecommendation.rate, 0)} label={`Finished action matched the recommendation (${u.completedMatchesRecommendation.n} cases)`} />
      </div>
    </Card>
  );
}

function ExportButton() {
  const [state, setState] = useState({ busy: false, error: '' });
  const download = async () => {
    setState({ busy: true, error: '' });
    try {
      const res = await fetch('/api/ai/real-cases.csv', { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error('Could not export the cases.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'real_cases.csv';
      a.click();
      URL.revokeObjectURL(url);
      setState({ busy: false, error: '' });
    } catch (e) {
      setState({ busy: false, error: e.message });
    }
  };
  return (
    <Card>
      <h2 className="mb-1 text-xl font-bold">Improve the model with real data (administrators)</h2>
      <p className="mb-3 text-sm text-muted">
        Exports cases where a user finished an action or said what they will do. The file has no names or emails. Save it as
        <code className="mx-1 rounded bg-paper px-1">server/ai-data/real_cases.csv</code> and run <code className="mx-1 rounded bg-paper px-1">npm run ml:train</code> to retrain on real outcomes.
      </p>
      <ErrorText error={state.error} />
      <Button onClick={download} disabled={state.busy}>{state.busy ? 'Exporting…' : 'Export real cases (CSV)'}</Button>
    </Card>
  );
}

export default function AiModel() {
  const { user } = useAuth();
  const model = useLoad(() => api.get('/ai/model'), []);
  const live = useLoad(() => api.get('/ai/usefulness'), []);

  return (
    <Page title="How the AI works">
      <div className="space-y-5">
        <Card>
          <h2 className="mb-2 text-xl font-bold">What the AI does here</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            <li><strong>Repairability and recycling decisions.</strong> A trained model estimates the probability that each option (keep using, repair, donate, recover parts, recycle) is the best choice for your device, and a repair worthiness score from 0 to 100.</li>
            <li><strong>Explains itself.</strong> It lists the facts that pushed the decision, such as repair cost compared with device value, age, liquid damage, and security updates.</li>
            <li><strong>Safety first.</strong> A written safety rule, such as a swollen battery, always overrides the AI. A separate rule check also runs as a second opinion, and the app tells you when it disagrees.</li>
            <li><strong>Photo helper.</strong> A pretrained image model can suggest the device type from a photo when you add a device. It is only a suggestion.</li>
            <li><strong>Gets measured.</strong> Users rate each recommendation, and the results appear below.</li>
          </ul>
        </Card>

        <ErrorText error={model.error || live.error} />
        {model.loading || live.loading ? <Loading /> : (
          <>
            {model.data?.available ? <Offline model={model.data.model} /> : <Notice kind="warn">No trained model file was found. Run <code>npm run ml:train</code> in the server folder.</Notice>}
            {live.data && <Live u={live.data} />}
            {user?.role === 'admin' && <ExportButton />}
          </>
        )}
      </div>
    </Page>
  );
}
