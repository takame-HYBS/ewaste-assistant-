import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import {
  ACTION_LABEL, AuthImage, Button, Card, ErrorText, Field, Loading, Notice, Page, peso, Pill, Select, Textarea, TYPE_LABEL,
  useLoad, variants,
} from '../ui.jsx';

// Which kind of place helps with each action.
const PLACE_TYPES = { repair: ['repair'], donate: ['donation'], recycle: ['recycling'], parts_recovery: ['repair', 'recycling'], reuse: [] };
const RULE_TITLE = (r) => r.rule.replace(/[._]/g, ' ');
const pct = (p) => `${Math.round(p * 100)}%`;

function ProbabilityBars({ probs, chosen }) {
  const rows = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  return (
    <ul className="space-y-2">
      {rows.map(([action, p]) => (
        <li key={action} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-3 text-sm">
          <span className={action === chosen ? 'font-bold' : ''}>{ACTION_LABEL[action]}</span>
          <span className="h-3 rounded-sm bg-paper" aria-hidden="true">
            <span className={`block h-3 rounded-sm ${action === chosen ? 'bg-board' : 'bg-line'}`} style={{ width: `${p * 100}%` }} />
          </span>
          <span className="text-right font-semibold">{pct(p)}</span>
        </li>
      ))}
    </ul>
  );
}

function Factors({ factors }) {
  if (!factors.length) return null;
  return (
    <ul className="divide-y divide-line text-sm">
      {factors.map((f) => (
        <li key={f.feature} className="grid grid-cols-[6.5rem_1fr] gap-3 py-2">
          <span className={`font-semibold ${f.direction === 'supports' ? 'text-board' : 'text-danger'}`}>
            {f.direction === 'supports' ? 'Supports' : 'Weighs against'}
          </span>
          <span>{f.text}</span>
        </li>
      ))}
    </ul>
  );
}

function AiCard({ a }) {
  const ai = a.ai;
  return (
    <Card>
      <h2 className="mb-1 text-xl font-bold">AI analysis</h2>
      <p className="mb-4 text-sm text-muted">
        A trained model (version {ai.modelVersion}) estimated how likely each action is the best choice for a device like yours.
      </p>
      <ProbabilityBars probs={ai.probabilities} chosen={ai.action} />

      <div className="mt-5 rounded-md border border-line bg-paper p-4">
        <p className="text-sm font-semibold">Repair worthiness</p>
        <p className="font-display text-4xl font-bold text-board-dark">{ai.repairScore}<span className="text-xl"> / 100</span></p>
        <p className="mt-1 text-sm text-muted">
          How strongly the AI favors repairing this device over the other options. Higher means repair is more likely to be worth it.
        </p>
      </div>

      {ai.factors.length > 0 && (
        <>
          <h3 className="mb-1 mt-5 font-bold">What drove this result</h3>
          <p className="mb-1 text-sm text-muted">Compared with the AI's second choice, these facts mattered most.</p>
          <Factors factors={ai.factors} />
        </>
      )}
    </Card>
  );
}

function FeedbackCard({ assessmentId, finalAction }) {
  const { data: existing, loading } = useLoad(() => api.get(`/assessments/${assessmentId}/feedback`), [assessmentId]);
  const [state, setState] = useState({ saving: false, error: '', saved: false });
  if (loading) return null;

  const submit = async (e) => {
    e.preventDefault();
    setState({ saving: true, error: '', saved: false });
    const f = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api.put(`/assessments/${assessmentId}/feedback`, {
        rating: Number(f.rating), will_follow: f.will_follow, chosen_action: f.chosen_action || null, comment: f.comment,
      });
      setState({ saving: false, error: '', saved: true });
    } catch (err) {
      setState({ saving: false, error: err.message, saved: false });
    }
  };

  return (
    <Card>
      <h2 className="mb-1 text-xl font-bold">Was this recommendation useful?</h2>
      <p className="mb-4 text-sm text-muted">Your answers help measure how well the AI works and improve it. They are never shown with your name.</p>
      <form onSubmit={submit} className="space-y-4">
        <ErrorText error={state.error} />
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">How helpful was it?</legend>
          <div className="flex flex-wrap gap-4">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="flex items-center gap-1 text-sm">
                <input type="radio" name="rating" value={n} required defaultChecked={existing?.rating === n} />
                {n}{n === 1 ? ' (not helpful)' : n === 5 ? ' (very helpful)' : ''}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Will you follow it?">
          <Select name="will_follow" required defaultValue={existing?.will_follow ?? ''}>
            <option value="" disabled>Choose one</option>
            <option value="yes">Yes</option>
            <option value="partly">Partly</option>
            <option value="no">No</option>
          </Select>
        </Field>
        <Field label="What do you plan to do?" hint="Optional.">
          <Select name="chosen_action" defaultValue={existing?.chosen_action ?? ''}>
            <option value="">Not decided</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Comment" hint="Optional.">
          <Textarea name="comment" maxLength={500} defaultValue={existing?.comment ?? ''} />
        </Field>
        <div className="flex items-center gap-3">
          <Button disabled={state.saving}>{state.saving ? 'Saving…' : existing || state.saved ? 'Update feedback' : 'Send feedback'}</Button>
          {state.saved && <span role="status" className="text-sm font-semibold text-board-dark">Saved. Thank you.</span>}
        </div>
      </form>
    </Card>
  );
}

export default function AssessmentResult() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: a, error, loading } = useLoad(() => api.get(`/assessments/${id}`), [id]);
  const places = useLoad(
    () => (a ? api.get(`/locations?category=${a.category_key}`) : Promise.resolve([])),
    [a?.category_key]
  );

  if (loading) return <Loading />;
  if (error) return <Page title="Recommendation"><ErrorText error={error} /></Page>;

  const confTone = { high: 'good', medium: 'warn', low: 'bad' }[a.confidence];
  const relevant = (places.data || []).filter((l) => PLACE_TYPES[a.result_action]?.includes(l.type));
  const hint = a.photo_hint;
  const ai = a.ai;
  const disagrees = ai && a.decision_source === 'ai' && a.rule_action !== ai.action;

  return (
    <Page title="Recommendation" actions={<Link to={`/devices/${a.device_id}`} className={variants.secondary}>Back to device</Link>}>
      <div className="space-y-5">
        {a.safety_notes.map((n) => <Notice key={n} kind="danger"><strong>Safety: </strong>{n}</Notice>)}

        <Card>
          <p className="text-sm text-muted">{a.brand} {a.model} · {a.category_label}</p>
          <h2 className="mt-1 text-4xl font-bold">{ACTION_LABEL[a.result_action]}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pill tone={confTone}>{a.confidence} confidence{ai && a.decision_source === 'ai' ? ` (${pct(ai.confidence)})` : ''}</Pill>
            {a.decision_source === 'ai' && <Pill tone="good">Decided by the AI model</Pill>}
            {a.decision_source === 'safety_override' && <Pill tone="bad">Safety rule override</Pill>}
            {a.decision_source === 'rules' && <Pill>Rule check only</Pill>}
            {a.repair_cost != null && (
              <Pill>Repair cost used: {peso(a.repair_cost)} ({a.repair_cost_source === 'user_quote' ? 'your quote' : 'rough estimate'})</Pill>
            )}
            {a.current_value != null && <Pill>Estimated value: {peso(a.current_value)}</Pill>}
          </div>
          {a.decision_source === 'safety_override' && ai && (
            <p className="mt-3 text-sm text-muted">The AI model alone would have chosen “{ACTION_LABEL[ai.action]}”, but a safety rule takes priority.</p>
          )}
          {a.confidence !== 'high' && a.decision_source !== 'safety_override' && (
            <p className="mt-3 text-sm text-muted">
              {a.repair_cost_source === 'rough_estimate'
                ? 'The repair cost is a rough estimate. Get a written quote and run the questions again for a more reliable result.'
                : 'The options scored close together, so treat this as a starting point and check with a technician.'}
            </p>
          )}
        </Card>

        {disagrees && (
          <Notice kind="warn">
            <strong>Second opinion differs. </strong>The separate rule check suggested “{ACTION_LABEL[a.rule_action]}” instead of
            “{ACTION_LABEL[ai.action]}”. When the two disagree, the result is less certain, so ask a technician before acting.
          </Notice>
        )}

        {ai && <AiCard a={a} />}

        <Card>
          <details open={!ai}>
            <summary className="cursor-pointer text-xl font-bold">
              Rule check{ai ? ` (second opinion: ${ACTION_LABEL[a.rule_action]})` : ''}
            </summary>
            <p className="mb-3 mt-2 text-sm text-muted">
              Each line is a written rule that applied to your answers. Positive points favor an option; negative points count against it.
            </p>
            {a.explanation.length === 0 ? <p className="text-sm text-muted">No rules adjusted the score.</p> : (
              <ul className="divide-y divide-line">
                {a.explanation.map((r, i) => (
                  <li key={i} className="grid grid-cols-[3.5rem_1fr] gap-3 py-2 text-sm">
                    <span className={`font-display text-lg font-bold ${r.points < 0 ? 'text-danger' : 'text-board'}`} aria-label={r.points == null ? 'safety rule' : `${r.points} points for ${ACTION_LABEL[r.action]}`}>
                      {r.points == null ? '!' : r.points > 0 ? `+${r.points}` : r.points}
                    </span>
                    <span>
                      <span className="font-semibold">{ACTION_LABEL[r.action]}</span>
                      <span className="text-muted"> · {RULE_TITLE(r)}</span>
                      <span className="block">{r.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </Card>

        <Card>
          <h2 className="mb-2 text-xl font-bold">Next steps</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">{a.nextSteps.map((s) => <li key={s}>{s}</li>)}</ul>
        </Card>

        {PLACE_TYPES[a.result_action]?.length > 0 && (
          <Card>
            <h2 className="mb-2 text-xl font-bold">Places that can help</h2>
            {relevant.length === 0 ? (
              <p className="text-sm text-muted">No verified places match yet. <Link className="underline" to="/locations">Browse the full map</Link>.</p>
            ) : (
              <ul className="divide-y divide-line">
                {relevant.slice(0, 5).map((l) => (
                  <li key={l.id} className="py-2 text-sm">
                    <span className="font-semibold">{l.name}</span> <span className="text-muted">· {TYPE_LABEL[l.type]}{l.city ? ` · ${l.city}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/locations" className="mt-3 inline-block text-sm underline">See all on the map</Link>
          </Card>
        )}

        {a.has_photo && (
          <Card>
            <h2 className="mb-2 text-xl font-bold">Your photo</h2>
            <AuthImage assessmentId={a.id} alt="The device you uploaded" className="max-h-72 rounded-md border border-line" />
            {hint && (
              <p className="mt-2 text-sm text-muted">
                Automatic guess: “{hint.label}”{hint.confidence != null ? ` (${Math.round(hint.confidence * 100)}%)` : ''}. {hint.note}
              </p>
            )}
          </Card>
        )}

        <FeedbackCard assessmentId={a.id} finalAction={a.result_action} />

        <Notice kind="warn">{a.disclaimer}</Notice>
        <div className="flex flex-wrap items-center gap-3">
          <button className={variants.primary} onClick={() => navigate(`/devices/${a.device_id}`)}>Record what you decide to do</button>
          <Link to="/ai" className="text-sm underline">How the AI works and how accurate it is</Link>
        </div>
      </div>
    </Page>
  );
}
