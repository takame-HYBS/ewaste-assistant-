// Turns a device + questionnaire answers into the numeric feature vector the AI model learns from.
// Used by BOTH training and prediction, so the two can never drift apart.
import { CATEGORY_DEFAULTS, GENERIC } from '../engine/recommend.js';

const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const yes = (v) => v === true || v === 'yes' || v === 'true';
const no = (v) => v === false || v === 'no' || v === 'false';

// Cost and value figures. Same formulas as the rule engine (a test checks they stay identical).
export function deriveFigures(input) {
  const answers = input.answers || {};
  const d = CATEGORY_DEFAULTS[input.category] || GENERIC;
  const lifespan = num(input.lifespanYears) || d.lifespan;
  const age = Math.max(0, num(input.ageYears) ?? 0);
  const condition = input.condition;
  const currentValue = Math.round(d.newPrice * Math.max(0.1, 1 - age / (lifespan * 1.5)));
  const cosmeticOnly = condition === 'minor_issues' && yes(answers.cosmetic_only);
  const needsRepair = condition !== 'working' && !cosmeticOnly;

  const quote = num(answers.repair_quote);
  let repairCost = null;
  let repairCostSource = null;
  if (quote !== null && quote >= 0) {
    repairCost = quote;
    repairCostSource = 'user_quote';
  } else if (needsRepair) {
    const kind = answers.screen_damage === 'cracked' || answers.screen_damage === 'dead' ? 'screen'
      : yes(answers.water_damage) ? 'water'
      : answers.battery_health === 'poor' && condition === 'minor_issues' ? 'battery'
      : 'other';
    repairCost = d.repair[kind];
    repairCostSource = 'rough_estimate';
  }
  const ratio = repairCost !== null && currentValue > 0 ? repairCost / currentValue : null;
  return { lifespan, age, currentValue, repairCost, repairCostSource, ratio, needsRepair, cosmeticOnly };
}

const bin = (b) => (b ? 1 : 0);

// kind 'numeric' features are standardised by the model; 'binary' features are used as 0/1.
// `text` explains the feature to a person when it influenced a prediction.
export const FEATURES = [
  { name: 'age_ratio', kind: 'numeric', fn: (c) => Math.min(c.fig.age / c.fig.lifespan, 2.5),
    text: (c) => `The device is ${c.fig.age} years old (typical lifespan is about ${c.fig.lifespan})` },
  { name: 'cost_ratio', kind: 'numeric', fn: (c) => (c.fig.needsRepair && c.fig.ratio !== null ? Math.min(c.fig.ratio, 3) : 0),
    text: (c) => `Repair is about ${Math.round((c.fig.ratio ?? 0) * 100)}% of the device's estimated value` },
  { name: 'cost_cheap', kind: 'binary', fn: (c) => bin(c.fig.needsRepair && c.fig.ratio !== null && c.fig.ratio <= 0.5), text: () => 'Repair costs less than half of what the device is worth' },
  { name: 'cost_mid', kind: 'binary', fn: (c) => bin(c.fig.needsRepair && c.fig.ratio !== null && c.fig.ratio > 0.5 && c.fig.ratio <= 0.8), text: () => 'Repair cost is close to the value of the device' },
  { name: 'cost_high', kind: 'binary', fn: (c) => bin(c.fig.needsRepair && c.fig.ratio !== null && c.fig.ratio > 0.8), text: () => 'Repair would cost about as much as the device is worth' },
  { name: 'has_quote', kind: 'binary', fn: (c) => bin(c.fig.repairCostSource === 'user_quote'), text: () => 'A real repair quote was provided' },
  { name: 'age_old', kind: 'binary', fn: (c) => bin(c.fig.age / c.fig.lifespan >= 1), text: () => 'The device is at or past its typical lifespan' },
  { name: 'age_very_old', kind: 'binary', fn: (c) => bin(c.fig.age / c.fig.lifespan >= 1.5), text: () => 'The device is well past its typical lifespan' },
  { name: 'cat_phone', kind: 'binary', fn: (c) => bin(c.input.category === 'phone'), text: () => 'It is a phone' },
  { name: 'cat_laptop', kind: 'binary', fn: (c) => bin(c.input.category === 'laptop'), text: () => 'It is a laptop' },
  { name: 'cat_tablet', kind: 'binary', fn: (c) => bin(c.input.category === 'tablet'), text: () => 'It is a tablet' },
  { name: 'cat_peripheral', kind: 'binary', fn: (c) => bin(c.input.category === 'peripheral'), text: () => 'It is a small peripheral' },
  { name: 'cond_working', kind: 'binary', fn: (c) => bin(c.input.condition === 'working'), text: () => 'The device works fine' },
  { name: 'cond_minor', kind: 'binary', fn: (c) => bin(c.input.condition === 'minor_issues'), text: () => 'It has minor issues' },
  { name: 'cond_major', kind: 'binary', fn: (c) => bin(c.input.condition === 'major_issues'), text: () => 'It has major issues' },
  { name: 'cond_not_working', kind: 'binary', fn: (c) => bin(c.input.condition === 'not_working'), text: () => 'The device does not work' },
  { name: 'powers_yes', kind: 'binary', fn: (c) => bin(c.a.powers_on === 'yes'), text: () => 'It turns on' },
  { name: 'powers_sometimes', kind: 'binary', fn: (c) => bin(c.a.powers_on === 'sometimes'), text: () => 'It only turns on sometimes' },
  { name: 'powers_no', kind: 'binary', fn: (c) => bin(c.a.powers_on === 'no'), text: () => 'It does not turn on' },
  { name: 'screen_cracked', kind: 'binary', fn: (c) => bin(c.a.screen_damage === 'cracked'), text: () => 'The screen is cracked' },
  { name: 'screen_dead', kind: 'binary', fn: (c) => bin(c.a.screen_damage === 'dead'), text: () => 'The screen does not display' },
  { name: 'water_damage', kind: 'binary', fn: (c) => bin(yes(c.a.water_damage)), text: () => 'Liquid damage was reported' },
  { name: 'battery_swollen', kind: 'binary', fn: (c) => bin(yes(c.a.battery_swollen)), text: () => 'The battery is swollen (safety risk)' },
  { name: 'battery_poor', kind: 'binary', fn: (c) => bin(c.a.battery_health === 'poor'), text: () => 'The battery drains quickly' },
  { name: 'software_unsupported', kind: 'binary', fn: (c) => bin(no(c.a.software_supported)), text: () => 'It no longer gets security updates' },
  { name: 'software_supported', kind: 'binary', fn: (c) => bin(yes(c.a.software_supported)), text: () => 'It still gets security updates' },
  { name: 'needed_no', kind: 'binary', fn: (c) => bin(no(c.a.still_needed)), text: () => 'You no longer need it' },
  { name: 'needed_yes', kind: 'binary', fn: (c) => bin(yes(c.a.still_needed)), text: () => 'You still need it' },
  { name: 'cosmetic_only', kind: 'binary', fn: (c) => bin(c.fig.cosmeticOnly), text: () => 'The damage is only cosmetic' },
  { name: 'minor_and_cheap', kind: 'binary', fn: (c) => bin(c.input.condition === 'minor_issues' && c.fig.ratio !== null && c.fig.needsRepair && c.fig.ratio <= 0.5), text: () => 'A minor issue that is cheap to fix' },
  { name: 'major_and_cheap', kind: 'binary', fn: (c) => bin(c.input.condition === 'major_issues' && c.fig.ratio !== null && c.fig.ratio <= 0.5), text: () => 'A major issue that is still cheap to fix' },
  { name: 'major_and_costly', kind: 'binary', fn: (c) => bin(c.input.condition === 'major_issues' && c.fig.ratio !== null && c.fig.ratio > 0.8), text: () => 'A major issue that costs too much to fix' },
  { name: 'broken_and_old', kind: 'binary', fn: (c) => bin(['major_issues', 'not_working'].includes(c.input.condition) && c.fig.age / c.fig.lifespan >= 1), text: () => 'A broken device that is already old' },
  { name: 'working_not_needed', kind: 'binary', fn: (c) => bin(c.input.condition === 'working' && no(c.a.still_needed)), text: () => 'It works but you no longer need it' },
  { name: 'working_unsupported', kind: 'binary', fn: (c) => bin(c.input.condition === 'working' && no(c.a.software_supported)), text: () => 'It works but no longer gets security updates' },
];

export const FEATURE_NAMES = FEATURES.map((f) => f.name);

export function context(input) {
  return { input, a: input.answers || {}, fig: deriveFigures(input) };
}

export function featurize(input) {
  const c = context(input);
  return FEATURES.map((f) => f.fn(c));
}
