import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLASSES, generateDataset } from '../ml/dataset.js';
import { GOLD } from '../ml/gold.js';
import { deriveFigures, FEATURES, featurize } from '../src/ai/features.js';
import { modelInfo, predict, predictProbs } from '../src/ai/model.js';
import { recommend } from '../src/engine/recommend.js';

const model = JSON.parse(readFileSync(new URL('../src/ai/model.json', import.meta.url), 'utf8'));

test('model file is consistent with the feature definitions', () => {
  assert.equal(model.features.length, FEATURES.length);
  model.features.forEach((f, i) => assert.equal(f.name, FEATURES[i].name, 'feature order must match training'));
  assert.deepEqual(model.classes, CLASSES);
  assert.equal(model.weights.length, CLASSES.length);
  model.weights.forEach((w) => assert.equal(w.length, FEATURES.length));
  assert.ok(model.weights.flat().every(Number.isFinite) && model.bias.every(Number.isFinite));
});

test('saved evaluation clears a minimum quality bar (guards against shipping a bad retrain)', () => {
  const h = model.evaluation.heldOutSynthetic;
  assert.ok(h.model.accuracy >= 0.7, `held-out accuracy ${h.model.accuracy}`);
  assert.ok(h.model.accuracy > h.majorityBaseline.accuracy + 0.2, 'must clearly beat always guessing the most common action');
  assert.ok(h.model.calibration.ece < 0.1, 'confidence should be reasonably calibrated');
  assert.ok(model.evaluation.goldHandWritten.model.n >= 30);
});

test('feature figures never drift from the rule engine (cost, value, quote source)', () => {
  const rows = [...generateDataset(300, 99), ...GOLD];
  for (const r of rows) {
    const input = { category: r.category, ageYears: r.ageYears, lifespanYears: r.lifespanYears, condition: r.condition, answers: r.answers };
    const fig = deriveFigures(input);
    const rule = recommend(input);
    assert.equal(fig.currentValue, rule.currentValue);
    assert.equal(fig.repairCost, rule.repairCost);
    assert.equal(fig.repairCostSource, rule.repairCostSource);
  }
});

test('probabilities are valid and the prediction is complete', () => {
  for (const r of generateDataset(200, 5)) {
    const p = predictProbs(r);
    assert.equal(p.length, CLASSES.length);
    assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
    const out = predict(r);
    assert.ok(CLASSES.includes(out.action));
    assert.ok(out.repairScore >= 0 && out.repairScore <= 100);
    assert.ok(['high', 'medium', 'low'].includes(out.confidenceLevel));
    out.factors.forEach((f) => assert.ok(f.text && ['supports', 'against'].includes(f.direction)));
  }
});

test('sensible behaviour on clear-cut cases', () => {
  const a = (extra) => ({ category: 'phone', lifespanYears: 4, ...extra });
  assert.equal(predict(a({ ageYears: 1, condition: 'working', answers: { still_needed: 'yes', software_supported: 'yes' } })).action, 'reuse');
  assert.equal(predict(a({ ageYears: 3, condition: 'working', answers: { still_needed: 'no', software_supported: 'yes' } })).action, 'donate');
  assert.equal(predict({ category: 'laptop', ageYears: 12, condition: 'not_working', answers: { powers_on: 'no', software_supported: 'no' } }).action, 'recycle');
  const cheap = predict(a({ ageYears: 2, condition: 'minor_issues', answers: { screen_damage: 'cracked', repair_quote: 1500, still_needed: 'yes' } }));
  const pricey = predict(a({ ageYears: 5, condition: 'minor_issues', answers: { screen_damage: 'cracked', repair_quote: 9000, still_needed: 'yes' } }));
  assert.ok(cheap.repairScore > pricey.repairScore, 'a cheaper repair should raise the repair score');
});

test('predictions are deterministic and explain themselves', () => {
  const input = { category: 'tablet', ageYears: 3, lifespanYears: 5, condition: 'major_issues', answers: { water_damage: 'yes', repair_quote: 2500 } };
  assert.deepEqual(predict(input), predict(input));
  assert.ok(predict(input).factors.length > 0);
  assert.equal(modelInfo().version, model.version);
});

test('garbage input never throws', () => {
  const out = predict({ category: undefined, ageYears: 'abc', condition: 'not_working', answers: { repair_quote: 'xyz' } });
  assert.ok(CLASSES.includes(out.action));
});
