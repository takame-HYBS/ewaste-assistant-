// Evaluation shared by training (`ml:train`) and re-scoring (`ml:evaluate`).
import { recommend } from '../src/engine/recommend.js';
import { CLASSES } from './dataset.js';
import {
  accuracy, argmax, auc, bootstrapCI, calibration, confusionMatrix, macroF1, mulberry32, perClass, topKAccuracy,
} from './lib/ml.js';

const K = CLASSES.length;
const idx = (label) => CLASSES.indexOf(label);

/**
 * @param rows        labelled cases
 * @param probsFn     (row) => array of K probabilities (one-hot for hard classifiers such as the rule engine)
 * @param soft        true when probsFn returns real probabilities (enables calibration, top-2 and AUC)
 */
export function evaluate(rows, probsFn, { soft = true } = {}) {
  const yTrue = rows.map((r) => idx(r.label));
  const probs = rows.map(probsFn);
  const yPred = probs.map(argmax);
  const cm = confusionMatrix(yTrue, yPred, K);
  const pc = perClass(cm);
  const acc = accuracy(yTrue, yPred);
  const out = {
    n: rows.length,
    accuracy: acc,
    macroF1: macroF1(pc),
    perClass: Object.fromEntries(CLASSES.map((c, k) => [c, pc[k]])),
    confusion: { classes: CLASSES, matrix: cm },
  };
  if (rows.length >= 100) {
    out.accuracyCI95 = bootstrapCI(yTrue.map((t, i) => (t === yPred[i] ? 1 : 0)), mulberry32(7));
  }
  // "Is repair the best option?" as a yes/no question: the core repairability decision.
  const repairIdx = idx('repair');
  const pos = yTrue.map((t) => t === repairIdx);
  const tp = yPred.filter((p, i) => p === repairIdx && pos[i]).length;
  const predPos = yPred.filter((p) => p === repairIdx).length;
  const actualPos = pos.filter(Boolean).length;
  const precision = predPos ? tp / predPos : 0;
  const recall = actualPos ? tp / actualPos : 0;
  out.repairDecision = {
    precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    auc: soft ? auc(probs.map((p) => p[repairIdx]), pos) : null,
  };
  if (soft) {
    out.top2Accuracy = topKAccuracy(yTrue, probs, 2);
    out.calibration = calibration(yTrue, probs);
  }
  return out;
}

export const ruleProbs = (row) => {
  const a = recommend({ category: row.category, ageYears: row.ageYears, lifespanYears: row.lifespanYears, condition: row.condition, answers: row.answers }).action;
  const p = new Array(K).fill(0);
  p[idx(a)] = 1;
  return p;
};

export function majorityBaseline(trainRows, testRows) {
  const counts = {};
  trainRows.forEach((r) => { counts[r.label] = (counts[r.label] || 0) + 1; });
  const majority = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return { majority, accuracy: testRows.filter((r) => r.label === majority).length / testRows.length };
}

// How much the simulated experts disagree with each other: a ceiling for what any model should be expected to reach.
export function panelAgreement(rows) {
  const pairs = [[0, 1], [0, 2], [1, 2]];
  const rowsWithVotes = rows.filter((r) => r.votes);
  if (!rowsWithVotes.length) return null;
  const pairwise = pairs.map(([a, b]) => rowsWithVotes.filter((r) => r.votes[a] === r.votes[b]).length / rowsWithVotes.length);
  const vsConsensus = [0, 1, 2].map((e) => rowsWithVotes.filter((r) => r.votes[e] === r.label).length / rowsWithVotes.length);
  return {
    n: rowsWithVotes.length,
    meanPairwiseAgreement: pairwise.reduce((a, b) => a + b, 0) / 3,
    meanExpertVsFinalLabel: vsConsensus.reduce((a, b) => a + b, 0) / 3,
  };
}

export const pct = (x, d = 1) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(d)}%`);
