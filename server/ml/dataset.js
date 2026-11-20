// Reproducible training data.
//
// IMPORTANT, READ THIS: there is no public dataset of "should this device be repaired or recycled" decisions.
// So the starter dataset is SYNTHETIC. Cases are sampled to look like real devices and questionnaire answers, and each
// case is labelled by a simulated panel of three decision-makers with DIFFERENT philosophies (eco-first, cost-first,
// safety-first), each with human-like inconsistency. The label is the panel's majority vote, plus 3% random label noise.
//
// What this means for the accuracy numbers: they measure how well the model reproduces a consensus of reasonable
// decision styles on unseen cases. They are NOT proof of real-world accuracy. Real accuracy comes from real data:
// the app records user feedback and outcomes, an admin exports them (Admin > AI), and `npm run ml:train` retrains on them.
import { deriveFigures } from '../src/ai/features.js';
import { CATEGORY_DEFAULTS } from '../src/engine/recommend.js';
import { gauss, mulberry32 } from './lib/ml.js';

export const CLASSES = ['reuse', 'repair', 'donate', 'parts_recovery', 'recycle'];

export const CSV_COLUMNS = [
  'category', 'age_years', 'lifespan_years', 'condition', 'powers_on', 'screen_damage', 'water_damage',
  'battery_swollen', 'battery_health', 'software_supported', 'still_needed', 'cosmetic_only', 'repair_quote', 'label', 'source',
];

function weighted(rnd, pairs) {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

// ---- Case sampler -------------------------------------------------------------------------------------------------
export function sampleCase(rnd) {
  const category = weighted(rnd, [['phone', 0.35], ['laptop', 0.28], ['tablet', 0.15], ['peripheral', 0.22]]);
  const d = CATEGORY_DEFAULTS[category];
  const lifespan = d.lifespan;
  const age = Math.round(Math.min(lifespan * 2.4, -Math.log(1 - rnd()) * lifespan * 0.7) * 2) / 2;
  const ar = Math.min(age / lifespan, 1.5) / 1.5;
  const condition = weighted(rnd, [
    ['working', 0.45 - 0.25 * ar], ['minor_issues', 0.28], ['major_issues', 0.17 + 0.1 * ar], ['not_working', 0.1 + 0.15 * ar],
  ]);
  const hasBattery = category !== 'peripheral';
  const answers = {};

  answers.powers_on = condition === 'working' ? 'yes'
    : condition === 'minor_issues' ? weighted(rnd, [['yes', 0.85], ['sometimes', 0.1], ['no', 0.05]])
    : condition === 'major_issues' ? weighted(rnd, [['yes', 0.35], ['sometimes', 0.3], ['no', 0.35]])
    : weighted(rnd, [['no', 0.7], ['sometimes', 0.2], ['yes', 0.1]]);

  if (category !== 'peripheral') {
    answers.screen_damage = condition === 'working' ? 'none'
      : condition === 'minor_issues' ? weighted(rnd, [['cracked', 0.4], ['none', 0.6]])
      : condition === 'major_issues' ? weighted(rnd, [['cracked', 0.3], ['dead', 0.3], ['none', 0.4]])
      : weighted(rnd, [['dead', 0.3], ['none', 0.5], ['cracked', 0.2]]);
    answers.software_supported = age / lifespan > 1.2 ? weighted(rnd, [['no', 0.55], ['yes', 0.3], ['unknown', 0.15]])
      : weighted(rnd, [['yes', 0.7], ['no', 0.15], ['unknown', 0.15]]);
  }
  answers.water_damage = rnd() < { working: 0.01, minor_issues: 0.05, major_issues: 0.2, not_working: 0.3 }[condition] ? 'yes' : 'no';
  if (hasBattery) {
    answers.battery_swollen = rnd() < 0.03 ? 'yes' : 'no';
    answers.battery_health = weighted(rnd, [['ok', 0.5 - 0.2 * ar], ['poor', 0.25 + 0.2 * ar], ['unknown', 0.25]]);
  }
  answers.still_needed = condition === 'working' ? weighted(rnd, [['yes', 0.6], ['no', 0.32], ['unknown', 0.08]])
    : weighted(rnd, [['yes', 0.5], ['no', 0.4], ['unknown', 0.1]]);
  if (condition === 'minor_issues') answers.cosmetic_only = rnd() < 0.3 ? 'yes' : 'no';

  if (condition !== 'working' && rnd() < 0.45) {
    const kind = answers.screen_damage === 'cracked' || answers.screen_damage === 'dead' ? 'screen' : answers.water_damage === 'yes' ? 'water' : 'other';
    answers.repair_quote = Math.max(100, Math.round((d.repair[kind] * Math.exp(0.4 * gauss(rnd))) / 50) * 50);
  }
  return { category, ageYears: age, lifespanYears: lifespan, condition, answers };
}

// ---- The simulated expert panel --------------------------------------------------------------------------------------
const zero = () => ({ reuse: 0, repair: 0, donate: 0, parts_recovery: 0, recycle: 0 });
const yes = (v) => v === 'yes';
const no = (v) => v === 'no';

function expertA(c, f, rnd) { // eco-first: keep things in use where reasonably possible
  const a = c.answers, s = zero();
  const r = f.ratio;
  if (c.condition === 'working') {
    if (no(a.still_needed)) { s.donate += 3; if (no(a.software_supported)) { s.donate -= 1; s.recycle += 1.5; } } else s.reuse += 3;
  } else if (c.condition === 'minor_issues') {
    if (f.cosmeticOnly) { s.reuse += 3; } else { s.repair += 2.5 + (r !== null && r <= 1 ? 1 : -2); s.reuse += 1 + (r !== null && r > 1 ? 1.5 : 0); }
  } else if (c.condition === 'major_issues') {
    s.repair += r !== null && r <= 0.9 ? 2.5 : -1; s.parts_recovery += 1.5; s.recycle += 0.5;
  } else {
    const knownCost = f.repairCostSource === 'user_quote'; // a real quote removes the guesswork
    s.repair += r !== null && r <= 0.7 && (knownCost || a.powers_on !== 'no') ? 2 : -0.5; s.parts_recovery += 2; s.recycle += 1;
  }
  if (f.age / f.lifespan >= 1.5) { s.repair -= 1.5; s.recycle += 1.5; }
  if (yes(a.water_damage)) s.repair -= 1;
  if (no(a.software_supported)) { s.repair -= 0.5; s.recycle += 1; }
  if (yes(a.battery_swollen)) s.recycle += 10;
  for (const k in s) s[k] += 0.7 * gauss(rnd);
  return s;
}

function expertB(c, f, rnd) { // cost-first
  const a = c.answers, s = zero();
  const r = f.ratio;
  const valuable = ['phone', 'laptop', 'tablet'].includes(c.category);
  if (c.condition === 'working') {
    if (no(a.still_needed)) { s.donate += 2.5 + (yes(a.software_supported) ? 0.5 : 0); s.reuse += 0.5; } else s.reuse += 3;
  } else if (f.cosmeticOnly) {
    s.reuse += 3;
  } else {
    if (r !== null) s.repair += r <= 0.5 ? 3 : r <= 0.8 ? 0.5 : -3;
    if (c.condition === 'minor_issues') s.repair += 1;
    if (c.condition === 'minor_issues' && a.powers_on === 'yes' && r !== null && r > 0.5) s.reuse += 2.5; // works, not worth fixing
    if (valuable) s.parts_recovery += 2; else s.recycle += 2;
    s.recycle += 1.5;
  }
  if (f.age / f.lifespan >= 1) s.repair -= 1;
  if (yes(a.battery_swollen)) s.recycle += 10;
  for (const k in s) s[k] += 0.7 * gauss(rnd);
  return s;
}

function expertC(c, f, rnd) { // safety-first
  const a = c.answers, s = zero();
  const r = f.ratio;
  const unsupported = no(a.software_supported);
  if (c.condition === 'working') {
    if (no(a.still_needed)) { s.donate += unsupported ? -1 : 3; s.recycle += unsupported ? 2 : 0; } else { s.reuse += unsupported ? 1 : 3; s.recycle += unsupported ? 1.5 : 0; }
  } else if (f.cosmeticOnly) {
    s.reuse += 3;
  } else {
    s.repair += c.condition === 'minor_issues' && r !== null && r <= 0.6 ? 1.5 : 0;
    if (c.condition === 'minor_issues' && a.powers_on === 'yes') s.reuse += 1.5; // still works
    s.parts_recovery += c.condition === 'not_working' ? 1 : 0.5;
    s.recycle += 1.5;
  }
  if (yes(a.water_damage)) { s.recycle += 2; s.repair -= 2; }
  if (a.battery_health === 'poor' && f.age / f.lifespan >= 1) { s.repair -= 1; s.recycle += 1; }
  if (unsupported && c.condition !== 'working') { s.recycle += 2; s.repair -= 1; }
  if (yes(a.battery_swollen)) s.recycle += 10;
  for (const k in s) s[k] += 0.7 * gauss(rnd);
  return s;
}

const best = (s) => CLASSES.reduce((b, k) => (s[k] > s[b] ? k : b), CLASSES[0]);

export function labelCase(c, rnd, labelNoise = 0.03) {
  const f = deriveFigures(c);
  const votes = [expertA(c, f, rnd), expertB(c, f, rnd), expertC(c, f, rnd)].map(best);
  const counts = {};
  votes.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  const top = Math.max(...Object.values(counts));
  const tied = Object.keys(counts).filter((k) => counts[k] === top);
  let label = tied[Math.floor(rnd() * tied.length)];
  if (rnd() < labelNoise) label = CLASSES[Math.floor(rnd() * CLASSES.length)];
  return { label, votes };
}

export function generateDataset(n, seed) {
  const rnd = mulberry32(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const c = sampleCase(rnd);
    const { label, votes } = labelCase(c, rnd);
    rows.push({ ...c, label, votes, source: 'synthetic' });
  }
  return rows;
}

// ---- CSV -------------------------------------------------------------------------------------------------------------
export function toCsvRow(c) {
  const a = c.answers || {};
  return [
    c.category, c.ageYears, c.lifespanYears ?? '', c.condition, a.powers_on ?? '', a.screen_damage ?? '', a.water_damage ?? '',
    a.battery_swollen ?? '', a.battery_health ?? '', a.software_supported ?? '', a.still_needed ?? '', a.cosmetic_only ?? '',
    a.repair_quote ?? '', c.label, c.source ?? '',
  ].join(',');
}
export const toCsv = (rows) => [CSV_COLUMNS.join(','), ...rows.map(toCsvRow)].join('\n') + '\n';

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(',');
    const r = Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? '').trim()]));
    const answers = {};
    for (const k of ['powers_on', 'screen_damage', 'water_damage', 'battery_swollen', 'battery_health', 'software_supported', 'still_needed', 'cosmetic_only']) {
      if (r[k]) answers[k] = r[k];
    }
    if (r.repair_quote !== '' && r.repair_quote !== undefined) answers.repair_quote = Number(r.repair_quote);
    return {
      category: r.category, ageYears: Number(r.age_years), lifespanYears: r.lifespan_years ? Number(r.lifespan_years) : undefined,
      condition: r.condition, answers, label: r.label, source: r.source || 'csv',
    };
  });
}
