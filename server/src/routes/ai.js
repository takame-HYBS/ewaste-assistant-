import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireRole, wrap } from '../middleware/auth.js';
import { aiAvailable, modelInfo } from '../ai/model.js';

const router = Router();

const ratio = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);

// Public: what the model is, how it was trained, and how it scored offline.
router.get('/model', (_req, res) => {
  res.json({ available: aiAvailable(), model: modelInfo() });
});

// Public: how useful the AI has been to real users. Aggregates only, nothing personal.
router.get('/usefulness', wrap(async (_req, res) => {
  const [assessed, agree, sources, fb, dist, follow, chosen, outcome] = await Promise.all([
    query(`SELECT count(*) AS n FROM assessments WHERE ai_action IS NOT NULL`),
    query(`SELECT count(*) AS n, coalesce(sum(CASE WHEN ai_action = rule_action THEN 1 ELSE 0 END), 0) AS same
           FROM assessments WHERE ai_action IS NOT NULL AND decision_source = 'ai'`),
    query(`SELECT decision_source, count(*) AS n FROM assessments WHERE decision_source IS NOT NULL GROUP BY decision_source`),
    query(`SELECT count(*) AS n, avg(rating) AS avg_rating, coalesce(sum(CASE WHEN rating >= 4 THEN 1 ELSE 0 END), 0) AS good FROM ai_feedback`),
    query(`SELECT rating, count(*) AS n FROM ai_feedback GROUP BY rating`),
    query(`SELECT will_follow, count(*) AS n FROM ai_feedback GROUP BY will_follow`),
    query(`SELECT count(*) AS n, coalesce(sum(CASE WHEN f.chosen_action = a.result_action THEN 1 ELSE 0 END), 0) AS same
           FROM ai_feedback f JOIN assessments a ON a.id = f.assessment_id WHERE f.chosen_action IS NOT NULL`),
    // Follow-through: when a user finished an action that was recorded against a recommendation, did it match?
    query(`SELECT count(*) AS n, coalesce(sum(CASE WHEN x.action = a.result_action THEN 1 ELSE 0 END), 0) AS same
           FROM device_actions x JOIN assessments a ON a.id = x.assessment_id WHERE x.status = 'completed'`),
  ]);

  const ratings = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  dist.rows.forEach((r) => { ratings[r.rating] = r.n; });
  const followed = { yes: 0, partly: 0, no: 0 };
  follow.rows.forEach((r) => { followed[r.will_follow] = r.n; });
  const bySource = {};
  sources.rows.forEach((r) => { bySource[r.decision_source] = r.n; });
  const nFeedback = fb.rows[0].n;

  res.json({
    recommendationsWithAi: assessed.rows[0].n,
    decidedBy: bySource,
    aiAgreesWithRules: { n: agree.rows[0].n, rate: ratio(agree.rows[0].same, agree.rows[0].n) },
    feedback: {
      n: nFeedback,
      averageRating: nFeedback ? Math.round(fb.rows[0].avg_rating * 100) / 100 : null,
      shareRated4or5: ratio(fb.rows[0].good, nFeedback),
      ratings,
      willFollow: followed,
      willFollowYesRate: ratio(followed.yes, nFeedback),
      willFollowYesOrPartlyRate: ratio(followed.yes + followed.partly, nFeedback),
    },
    chosenMatchesRecommendation: { n: chosen.rows[0].n, rate: ratio(chosen.rows[0].same, chosen.rows[0].n) },
    completedMatchesRecommendation: { n: outcome.rows[0].n, rate: ratio(outcome.rows[0].same, outcome.rows[0].n) },
  });
}));

const CSV_COLUMNS = [
  'category', 'age_years', 'lifespan_years', 'condition', 'powers_on', 'screen_damage', 'water_damage',
  'battery_swollen', 'battery_health', 'software_supported', 'still_needed', 'cosmetic_only', 'repair_quote', 'label', 'source',
];
const csvCell = (v) => String(v ?? '').replace(/[,\r\n]/g, ' ');

// Admin: real labelled cases for retraining. Label = what the user actually completed, else what they said they will do.
// Save the download as server/ai-data/real_cases.csv and run `npm run ml:train`. Contains no names or emails.
router.get('/real-cases.csv', requireRole('admin'), wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT category, age_years, lifespan_years, condition, answers, label, source FROM (
       SELECT c.key AS category, d.age_years, c.typical_lifespan_years AS lifespan_years, d.condition, a.answers,
              coalesce(
                (SELECT x.action FROM device_actions x WHERE x.assessment_id = a.id AND x.status = 'completed' ORDER BY x.updated_at DESC LIMIT 1),
                f.chosen_action) AS label,
              CASE WHEN EXISTS (SELECT 1 FROM device_actions x WHERE x.assessment_id = a.id AND x.status = 'completed')
                   THEN 'real_completed' ELSE 'real_feedback' END AS source
       FROM assessments a
       JOIN devices d ON d.id = a.device_id
       JOIN device_categories c ON c.id = d.category_id
       LEFT JOIN ai_feedback f ON f.assessment_id = a.id
     ) WHERE label IS NOT NULL`
  );
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    const a = r.answers || {};
    lines.push([
      r.category, r.age_years, r.lifespan_years, r.condition, a.powers_on, a.screen_damage, a.water_damage, a.battery_swollen,
      a.battery_health, a.software_supported, a.still_needed, a.cosmetic_only, a.repair_quote, r.label, r.source,
    ].map(csvCell).join(','));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="real_cases.csv"');
  res.send(lines.join('\n') + '\n');
}));

export default router;
