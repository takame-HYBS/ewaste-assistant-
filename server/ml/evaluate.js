// Re-scores the SAVED model (src/ai/model.json) on the hand-written gold set and on any real cases.
// Use it after editing gold labels in ml/gold.js or adding ai-data/real_cases.csv.   Run:  npm run ml:evaluate
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { predict, predictProbs } from '../src/ai/model.js';
import { CLASSES, parseCsv } from './dataset.js';
import { evaluate, majorityBaseline, pct, ruleProbs } from './evaluation.js';
import { GOLD } from './gold.js';

if (!predict({ category: 'phone', ageYears: 1, condition: 'working', answers: {} })) {
  console.error('No trained model found. Run: npm run ml:train');
  process.exit(1);
}

function report(name, rows) {
  const m = evaluate(rows, predictProbs);
  const r = evaluate(rows, ruleProbs, { soft: false });
  const base = majorityBaseline(rows, rows);
  console.log(`\n${name} (n=${rows.length})`);
  console.log(`  AI model     accuracy ${pct(m.accuracy)}   macro-F1 ${pct(m.macroF1)}   top-2 ${pct(m.top2Accuracy)}`);
  console.log(`  Rule engine  accuracy ${pct(r.accuracy)}   macro-F1 ${pct(r.macroF1)}`);
  console.log(`  Baseline (always "${base.majority}") ${pct(base.accuracy)}`);
  const wrong = rows.map((row) => ({ row, p: predict(row) })).filter(({ row, p }) => p.action !== row.label);
  if (wrong.length) {
    console.log('  Cases the model got wrong (check whether the label or the model is at fault):');
    for (const { row, p } of wrong) {
      console.log(`   - ${row.desc || `${row.category}, ${row.ageYears}y, ${row.condition}`}: label=${row.label}, model=${p.action} (${Math.round(p.confidence * 100)}%), runner-up=${p.runnerUp}`);
    }
  }
}

report('Gold hand-written set', GOLD);

const realPath = fileURLToPath(new URL('../ai-data/real_cases.csv', import.meta.url));
if (existsSync(realPath)) {
  const real = parseCsv(readFileSync(realPath, 'utf8')).filter((r) => CLASSES.includes(r.label));
  if (real.length) report('Real cases from the app', real);
  else console.log('\nreal_cases.csv has no usable rows yet.');
} else {
  console.log('\nNo ai-data/real_cases.csv yet. Export real cases from Admin > AI after users have given feedback.');
}
