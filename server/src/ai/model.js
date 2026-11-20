// Runtime predictor. Loads the trained model (model.json) and turns a device assessment into probabilities for each
// action, a "repair worthiness" score, and the factors that pushed the decision. Pure JS, no extra packages.
import { readFileSync } from 'node:fs';
import { FEATURES, context, featurize } from './features.js';

let model = null;
try {
  model = JSON.parse(readFileSync(new URL('./model.json', import.meta.url), 'utf8'));
} catch {
  model = null; // not trained yet: the app falls back to the rule engine alone
}

export const aiAvailable = () => model !== null;
export const modelInfo = () => (model ? {
  version: model.version, trainedAt: model.trainedAt, classes: model.classes, algorithm: model.algorithm,
  features: model.features.length, training: model.training, evaluation: model.evaluation,
} : null);

function softmax(z) {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

const scale = (x) => x.map((v, j) => (v - model.features[j].mean) / model.features[j].std);
const logits = (xs) => model.weights.map((w, k) => w.reduce((s, wj, j) => s + wj * xs[j], model.bias[k]));

export function predictProbs(input) {
  return softmax(logits(scale(featurize(input))));
}

const level = (p) => (p >= 0.7 ? 'high' : p >= 0.5 ? 'medium' : 'low');

/**
 * @returns null when no trained model is available, else
 *   { action, confidence, confidenceLevel, probabilities, repairScore, factors, modelVersion }
 */
export function predict(input) {
  if (!model) return null;
  const x = featurize(input);
  const xs = scale(x);
  const probs = softmax(logits(xs));
  const order = probs.map((p, k) => [p, k]).sort((a, b) => b[0] - a[0]);
  const top = order[0][1];
  const second = order[1][1];

  // Explanation: which features pushed the winner above the runner-up (weight difference x feature value).
  const ctx = context(input);
  const contrib = FEATURES.map((f, j) => ({
    feature: f.name,
    effect: (model.weights[top][j] - model.weights[second][j]) * xs[j],
    active: x[j] !== 0,
    text: f.text(ctx),
  })).filter((c) => c.active && Math.abs(c.effect) >= 0.05);
  contrib.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  const factors = contrib.slice(0, 6).map((c) => ({
    feature: c.feature, text: c.text, effect: Math.round(c.effect * 100) / 100,
    direction: c.effect > 0 ? 'supports' : 'against',
  }));

  const probabilities = Object.fromEntries(model.classes.map((c, k) => [c, Math.round(probs[k] * 1000) / 1000]));
  return {
    action: model.classes[top],
    confidence: Math.round(probs[top] * 1000) / 1000,
    confidenceLevel: level(probs[top]),
    runnerUp: model.classes[second],
    probabilities,
    repairScore: Math.round(probabilities.repair * 100),
    factors,
    modelVersion: model.version,
  };
}
