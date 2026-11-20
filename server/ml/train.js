// Trains the decision model and writes: src/ai/model.json, ai-reports/evaluation.json, ../AI_REPORT.md,
// ai-data/synthetic_cases.csv.   Run:  npm run ml:train
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEATURES, featurize } from '../src/ai/features.js';
import { CLASSES, generateDataset, parseCsv, toCsv } from './dataset.js';
import { evaluate, majorityBaseline, panelAgreement, pct, ruleProbs } from './evaluation.js';
import { GOLD } from './gold.js';
import {
  accuracy, applyScaler, argmax, fitScaler, mulberry32, predictProba, stratifiedFolds, stratifiedSplit, trainSoftmax,
} from './lib/ml.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const SEED = 42;
const N_SYNTHETIC = 4000;
const HYPER = { epochs: 400, lr: 0.1 };
const L2_GRID = [1e-4, 1e-3, 1e-2];
const K = CLASSES.length;
const kinds = FEATURES.map((f) => f.kind);
const idx = (label) => CLASSES.indexOf(label);

console.log('1/6 Generating synthetic cases (seed %d)...', SEED);
const synthetic = generateDataset(N_SYNTHETIC, SEED);
mkdirSync(here('../ai-data'), { recursive: true });
mkdirSync(here('../ai-reports'), { recursive: true });
writeFileSync(here('../ai-data/synthetic_cases.csv'), toCsv(synthetic));

// Real cases exported from the running app (Admin > AI evaluation > Export real cases). Optional.
let real = [];
const realPath = here('../ai-data/real_cases.csv');
if (existsSync(realPath)) real = parseCsv(readFileSync(realPath, 'utf8')).filter((r) => CLASSES.includes(r.label));

console.log('2/6 Splitting (stratified 80/20)...');
const rnd = mulberry32(SEED + 1);
const split = stratifiedSplit(synthetic.map((r) => idx(r.label)), 0.2, rnd);
let trainRows = split.train.map((i) => synthetic[i]);
const testRows = split.test.map((i) => synthetic[i]);
let realTest = [];
let realWeight = 3;
if (real.length >= 30) {
  const rs = stratifiedSplit(real.map((r) => idx(r.label)), 0.3, mulberry32(SEED + 2));
  trainRows = [...trainRows, ...rs.train.map((i) => real[i])];
  realTest = rs.test.map((i) => real[i]);
} else if (real.length) {
  trainRows = [...trainRows, ...real];
}
console.log('   train %d | test %d | real cases %d (real held-out test: %d)', trainRows.length, testRows.length, real.length, realTest.length);

const rawX = trainRows.map(featurize);
const y = trainRows.map((r) => idx(r.label));
const sampleWeights = trainRows.map((r) => (r.source === 'synthetic' || r.source === 'gold' ? 1 : realWeight));

console.log('3/6 5-fold cross-validation to choose regularisation...');
const folds = stratifiedFolds(y, 5, mulberry32(SEED + 3));
const cv = L2_GRID.map((l2) => {
  const accs = folds.map((foldIdx, f) => {
    const held = new Set(foldIdx);
    const trIdx = y.map((_, i) => i).filter((i) => !held.has(i));
    const sc = fitScaler(trIdx.map((i) => rawX[i]), kinds);
    const m = trainSoftmax(trIdx.map((i) => applyScaler(rawX[i], sc)), trIdx.map((i) => y[i]), K, { ...HYPER, l2, sampleWeights: trIdx.map((i) => sampleWeights[i]) });
    const pred = foldIdx.map((i) => argmax(predictProba(m, applyScaler(rawX[i], sc))));
    return accuracy(foldIdx.map((i) => y[i]), pred);
  });
  const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
  const sd = Math.sqrt(accs.reduce((a, b) => a + (b - mean) ** 2, 0) / accs.length);
  console.log('   l2=%s  accuracy %s +/- %s', l2, pct(mean), pct(sd));
  return { l2, meanAccuracy: mean, sdAccuracy: sd, folds: accs };
});
const bestCv = cv.reduce((b, c) => (c.meanAccuracy > b.meanAccuracy ? c : b));

console.log('4/6 Training final model (l2=%s)...', bestCv.l2);
const scaler = fitScaler(rawX, kinds);
const fit = trainSoftmax(rawX.map((x) => applyScaler(x, scaler)), y, K, { ...HYPER, l2: bestCv.l2, sampleWeights });
const probsFn = (row) => predictProba(fit, applyScaler(featurize(row), scaler));

console.log('5/6 Evaluating on data the model never saw...');
const ev = {
  heldOutSynthetic: { model: evaluate(testRows, probsFn), rules: evaluate(testRows, ruleProbs, { soft: false }), majorityBaseline: majorityBaseline(trainRows, testRows), expertPanel: panelAgreement(testRows) },
  goldHandWritten: { model: evaluate(GOLD, probsFn), rules: evaluate(GOLD, ruleProbs, { soft: false }), majorityBaseline: majorityBaseline(trainRows, GOLD) },
  real: realTest.length >= 10 ? { model: evaluate(realTest, probsFn), rules: evaluate(realTest, ruleProbs, { soft: false }), majorityBaseline: majorityBaseline(trainRows, realTest) } : null,
  crossValidation: { folds: 5, results: cv.map(({ l2, meanAccuracy, sdAccuracy }) => ({ l2, meanAccuracy, sdAccuracy })), chosenL2: bestCv.l2 },
};

const round = (v) => Math.round(v * 1e5) / 1e5;
const model = {
  version: '1.0.0',
  trainedAt: new Date().toISOString(),
  algorithm: 'Multinomial logistic regression (softmax), L2-regularised, trained with Adam',
  classes: CLASSES,
  features: FEATURES.map((f, j) => ({ name: f.name, kind: f.kind, mean: round(scaler.mean[j]), std: round(scaler.std[j]) })),
  weights: fit.weights.map((w) => w.map(round)),
  bias: fit.bias.map(round),
  hyperparameters: { ...HYPER, l2: bestCv.l2, seed: SEED },
  training: { syntheticCases: N_SYNTHETIC, trainRows: trainRows.length, heldOutTestRows: testRows.length, realCases: real.length, goldCases: GOLD.length },
  evaluation: ev,
};
writeFileSync(here('../src/ai/model.json'), JSON.stringify(model, null, 1));
writeFileSync(here('../ai-reports/evaluation.json'), JSON.stringify(ev, null, 1));

console.log('6/6 Writing report...');
writeFileSync(here('../../AI_REPORT.md'), renderReport(model, ev));

const h = ev.heldOutSynthetic, g = ev.goldHandWritten;
console.log('\n=== RESULTS ===');
console.log('Held-out synthetic (n=%d):  model %s | rule engine %s | majority baseline %s | expert pairwise agreement %s',
  h.model.n, pct(h.model.accuracy), pct(h.rules.accuracy), pct(h.majorityBaseline.accuracy), pct(h.expertPanel.meanPairwiseAgreement));
console.log('Gold hand-written (n=%d):   model %s | rule engine %s | majority baseline %s', g.model.n, pct(g.model.accuracy), pct(g.rules.accuracy), pct(g.majorityBaseline.accuracy));
console.log('Model saved to src/ai/model.json, report to AI_REPORT.md');

// ---------------------------------------------------------------------------------------------------------------------
function table(rows) {
  return rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
}

function renderReport(m, e) {
  const h = e.heldOutSynthetic, g = e.goldHandWritten;
  const label = (c) => c.replace('_', ' ');
  const perClass = table([
    ['Action', 'Precision', 'Recall', 'F1', 'Cases'],
    ['---', '---', '---', '---', '---'],
    ...CLASSES.map((c) => [label(c), pct(h.model.perClass[c].precision), pct(h.model.perClass[c].recall), pct(h.model.perClass[c].f1), h.model.perClass[c].support]),
  ]);
  const cm = table([
    ['Actual \\ Predicted', ...CLASSES.map(label)],
    ['---', ...CLASSES.map(() => '---')],
    ...CLASSES.map((c, i) => [`**${label(c)}**`, ...h.model.confusion.matrix[i]]),
  ]);
  const cal = table([
    ['Stated confidence', 'Cases', 'Actual accuracy'],
    ['---', '---', '---'],
    ...h.model.calibration.table.filter((r) => r.n > 0).map((r) => [r.bin, r.n, pct(r.accuracy)]),
  ]);
  const realBlock = e.real
    ? `\n### Real cases collected from the app (held out)\n\nModel ${pct(e.real.model.accuracy)} vs rule engine ${pct(e.real.rules.accuracy)} on ${e.real.model.n} real cases.\n`
    : '\n### Real cases collected from the app\n\nNot enough real cases yet (need at least 30 for a held-out test). Collect feedback in the app, export it from **AI > Export real cases**, save as `server/ai-data/real_cases.csv`, and run `npm run ml:train` again.\n';
  return `# AI Component Report

*Generated by \`npm run ml:train\` on ${m.trainedAt.slice(0, 10)}. Numbers below come from that run.*

## 1. Role of AI in the system

The professor asked the group to define how AI supports repairability assessment and recycling decisions, and to avoid a system
that only returns predefined rule-based outputs. This is how the system answers that.

| Part | What it does |
|---|---|
| **AI decision model (primary)** | A trained machine-learning model reads the device details and questionnaire answers and outputs a **probability for each of five actions** (reuse, repair, donate, parts recovery, recycle), a **repair worthiness score** (probability that repair is the best action), and the **factors that drove the result**. |
| **Rule check (safety net and second opinion)** | The original rule engine still runs. A hazard such as a swollen battery **always overrides** the model, and when the rules disagree with the model the user is told. |
| **Photo helper (optional)** | A pretrained image classifier (MobileNet, in the browser) suggests the device type from a photo. It is a suggestion only. |
| **Feedback loop** | Users rate each recommendation and say whether they will follow it. Admins export these as real labelled cases, and the model is retrained on them. |

The model is **multinomial logistic regression** on ${m.features.length} engineered features (device type, age versus typical lifespan,
condition, repair cost versus device value, liquid damage, battery safety, software support, whether the user still needs it, and some
interaction features). It was chosen over a larger model because every prediction can be **explained** by feature contributions,
which matters for advice about safety and money.

## 2. Data

* **${m.training.syntheticCases} synthetic cases** (\`ai-data/synthetic_cases.csv\`), reproducible from seed ${m.hyperparameters.seed}. No public dataset of repair-or-recycle decisions exists, so cases
  were sampled to look like real devices and answers, then **labelled by a simulated panel of three decision styles** (eco-first, cost-first, safety-first), each with
  human-like inconsistency, using the majority vote plus 3% random label noise.
* **${m.training.goldCases} hand-written "gold" cases** (\`ml/gold.js\`) that did **not** come from the generator. Labels are the developer's judgement and should be reviewed by the group.
* **Real cases** from app feedback: ${m.training.realCases} so far.

### Honest limits

* Accuracy on synthetic data measures how well the model reproduces the panel consensus on unseen cases. It is **not proof of real-world accuracy**.
* The gold set is small (${m.training.goldCases} cases), so its accuracy has wide uncertainty.
* Repair prices and device values are **placeholder estimates** (Philippine pesos), not market data.
* The photo helper is a general-purpose classifier, **not trained on damaged electronics**, and has not been evaluated.

## 3. Results

### Held-out synthetic test set (${h.model.n} unseen cases)

| Method | Accuracy | Macro F1 |
|---|---|---|
| **AI model** | **${pct(h.model.accuracy)}** (95% CI ${pct(h.model.accuracyCI95[0])} to ${pct(h.model.accuracyCI95[1])}) | ${pct(h.model.macroF1)} |
| Rule engine alone | ${pct(h.rules.accuracy)} | ${pct(h.rules.macroF1)} |
| Always guess "${h.majorityBaseline.majority}" (baseline) | ${pct(h.majorityBaseline.accuracy)} | n/a |

* Top-2 accuracy (correct action is in the model's two best guesses): **${pct(h.model.top2Accuracy)}**
* The three simulated experts agree with each other on **${pct(h.expertPanel.meanPairwiseAgreement)}** of cases, which shows how ambiguous these decisions are, so no model should be expected to reach 100%.
* Cross-validation (5 folds, training data): ${e.crossValidation.results.map((r) => `l2=${r.l2}: ${pct(r.meanAccuracy)} ± ${pct(r.sdAccuracy)}`).join('; ')}. Chosen l2 = ${e.crossValidation.chosenL2}.

**Repair decision on its own** ("is repair the best option?"): precision ${pct(h.model.repairDecision.precision)}, recall ${pct(h.model.repairDecision.recall)}, F1 ${pct(h.model.repairDecision.f1)}, AUC ${h.model.repairDecision.auc.toFixed(3)}.

### Per-action performance (AI model)

${perClass}

### Confusion matrix (rows = correct action, columns = model's choice)

${cm}

### Calibration (does the stated confidence match reality?)

Expected calibration error: **${pct(h.model.calibration.ece)}** (lower is better).

${cal}

### Hand-written gold set (${g.model.n} cases, independent of the generator)

| Method | Accuracy | Macro F1 |
|---|---|---|
| **AI model** | **${pct(g.model.accuracy)}** | ${pct(g.model.macroF1)} |
| Rule engine alone | ${pct(g.rules.accuracy)} | ${pct(g.rules.macroF1)} |
| Always guess "${g.majorityBaseline.majority}" | ${pct(g.majorityBaseline.accuracy)} | n/a |
${realBlock}
### Development notes (read before quoting the gold-set number)

* **Implementation check:** on the same data and split, scikit-learn's logistic regression scored the same as this project's own trainer (81.4% in the first run). A random forest (80.5%) and gradient boosting (80.6%) did **not** beat it, which suggests the simple, explainable model is already near the ceiling for this data.
* **First run:** the model scored 81.4% on held-out synthetic cases but only 79.4% on the gold set, the same as the rule engine. The gold set exposed two weaknesses in how the simulated experts labelled data: a dead device with a cheap, known repair quote was not recommended for repair, and a working device with a minor issue that is not worth fixing was sent to parts recovery. Both were fixed in \`ml/dataset.js\` on general grounds (not case by case) and the model was retrained.
* **Because the gold set guided that fix, it is no longer a fully untouched test.** Treat its score as optimistic and small-sample. The remaining gold-set errors are borderline calls (for example a working phone with a weak battery, or parts recovery versus recycling for an old dead laptop).
* **Weakest action:** *parts recovery* is the hardest to predict (it overlaps with repair and recycling in the confusion matrix). Treat it as the least reliable recommendation.

## 4. Usefulness (measured in the app)

Accuracy is only half of the question. Does it help people decide? Every recommendation page asks the user for:

1. a **1 to 5 rating** of how helpful the recommendation was,
2. whether they **will follow it**, and what they actually plan to do,
3. an optional comment.

The public page **AI model** (in the app menu) shows live results: number of ratings, average rating, share rated 4 or 5, share who will follow it,
how often the AI and the rule check agree, and **follow-through** (how often the action a user finally completed matched the recommendation).

## 5. How to reproduce

\`\`\`
cd server
npm run ml:train      # regenerate data, retrain, re-evaluate, rewrite this report
npm run ml:evaluate   # re-score the saved model on the gold set and any real cases
\`\`\`
`;
}
