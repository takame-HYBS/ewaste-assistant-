import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { requireAuth, wrap } from '../middleware/auth.js';
import { HttpError, id, oneOf, numberIn, str } from '../validate.js';
import { recommend, ENGINE_VERSION, NEXT_STEPS } from '../engine/recommend.js';
import { classifyImage } from '../engine/imageHint.js';
import { predict } from '../ai/model.js';
import { loadDevice, syncDeviceStatus } from '../services/devices.js';
import { photoFullPath, removePhotoFile, sniffImageType } from '../services/photos.js';

// Two routers: one mounted under /api/devices (create), one under /api/assessments (read/delete).
export const forDevice = Router({ mergeParams: true });
export const standalone = Router();
forDevice.use(requireAuth);
standalone.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

const YES_NO = ['yes', 'no'];
const ANSWER_RULES = {
  powers_on: ['yes', 'no', 'sometimes'],
  screen_damage: ['none', 'cracked', 'dead'],
  water_damage: YES_NO,
  battery_swollen: YES_NO,
  battery_health: ['ok', 'poor', 'unknown'],
  has_personal_data: YES_NO,
  software_supported: ['yes', 'no', 'unknown'],
  still_needed: YES_NO,
  cosmetic_only: YES_NO,
};

// Whitelist keys and values: unknown keys are dropped, bad values rejected.
function cleanAnswers(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { throw new HttpError(400, 'Answers must be valid JSON.'); }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [key, allowed] of Object.entries(ANSWER_RULES)) {
    const v = obj[key];
    if (v === undefined || v === null || v === '') continue;
    if (!allowed.includes(v)) throw new HttpError(400, `Invalid answer for ${key}.`);
    out[key] = v;
  }
  const quote = obj.repair_quote;
  if (quote !== undefined && quote !== null && quote !== '') {
    const n = Number(quote);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new HttpError(400, 'Repair quote must be a positive number.');
    out.repair_quote = n;
  }
  return out;
}

forDevice.post('/:id/assessments', upload.single('photo'), wrap(async (req, res) => {
  const device = await loadDevice(req, id(req.params.id));
  const answers = cleanAnswers(req.body.answers);

  let photoPath = null;
  let photoHint = null;
  if (req.file) {
    const type = sniffImageType(req.file.buffer);
    if (!type) throw new HttpError(400, 'Photo must be a JPEG, PNG or WebP image.');
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
    photoPath = `${crypto.randomUUID()}.${ext}`;
    await mkdir(config.uploadDir, { recursive: true });
    await writeFile(photoFullPath(photoPath), req.file.buffer);
    photoHint = await classifyImage(req.file.buffer, type);
  }

  const input = {
    category: device.category_key,
    ageYears: Number(device.age_years),
    condition: device.condition,
    lifespanYears: device.typical_lifespan_years,
    answers,
  };
  const result = recommend(input);   // rule engine: safety guardrail, explanations and second opinion
  const ai = predict(input);         // trained model: the primary decision (null if no model file is present)

  // Who decides: a safety hazard always wins; otherwise the AI model; the rules alone only if no model is available.
  const hazard = result.explanation.some((e) => e.rule === 'safety.swollen_battery');
  let finalAction = result.action;
  let confidence = result.confidence;
  let source = 'rules';
  if (hazard) {
    finalAction = 'recycle'; confidence = 'high'; source = 'safety_override';
  } else if (ai) {
    finalAction = ai.action; confidence = ai.confidenceLevel; source = 'ai';
  }

  let row;
  try {
    ({ rows: [row] } = await query(
      `INSERT INTO assessments
         (device_id, method, answers, photo_path, photo_hint, result_action, confidence, ranking, explanation,
          safety_notes, repair_cost, repair_cost_source, current_value, engine_version,
          ai_action, ai_confidence, ai_probabilities, ai_factors, ai_model_version, repair_score, rule_action, decision_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id`,
      [
        device.id, photoPath ? 'photo' : 'questionnaire', answers, photoPath, photoHint,
        finalAction, confidence, JSON.stringify(result.ranking), JSON.stringify(result.explanation),
        JSON.stringify(result.safetyNotes), result.repairCost, result.repairCostSource, result.currentValue,
        ENGINE_VERSION,
        ai?.action ?? null, ai?.confidence ?? null, ai ? JSON.stringify(ai.probabilities) : null,
        ai ? JSON.stringify(ai.factors) : null, ai?.modelVersion ?? null, ai?.repairScore ?? null, result.action, source,
      ]
    ));
  } catch (err) {
    await removePhotoFile(photoPath); // don't leave an orphaned upload behind
    throw err;
  }
  await syncDeviceStatus(device.id);
  res.status(201).json(await loadAssessment(req, row.id));
}));

async function loadAssessment(req, assessmentId) {
  const { rows } = await query(
    `SELECT a.*, d.user_id, d.brand, d.model, c.key AS category_key, c.label AS category_label
     FROM assessments a
     JOIN devices d ON d.id = a.device_id
     JOIN device_categories c ON c.id = d.category_id
     WHERE a.id = $1`,
    [assessmentId]
  );
  const a = rows[0];
  if (!a || (a.user_id !== req.user.id && req.user.role !== 'admin')) throw new HttpError(404, 'Assessment not found.');
  const {
    photo_path, user_id, ai_action, ai_confidence, ai_probabilities, ai_factors, ai_model_version, repair_score, rule_action,
    decision_source, ...rest
  } = a;
  return {
    ...rest,
    has_photo: Boolean(photo_path),
    decision_source,
    rule_action,
    ai: ai_action ? {
      action: ai_action, confidence: ai_confidence, probabilities: ai_probabilities, factors: ai_factors || [],
      repairScore: repair_score, modelVersion: ai_model_version, agreesWithRules: ai_action === rule_action,
    } : null,
    nextSteps: NEXT_STEPS[a.result_action] || [], // derived from the action, not stored
    disclaimer:
      'This is general guidance based on what you told us, not a diagnosis of the device. A qualified technician should ' +
      'confirm any repair decision, especially for batteries, power supplies, or liquid damage.',
  };
}

standalone.get('/:id', wrap(async (req, res) => {
  res.json(await loadAssessment(req, id(req.params.id)));
}));

// Photos are private: only the owner or an admin can fetch them.
standalone.get('/:id/photo', wrap(async (req, res) => {
  const aid = id(req.params.id);
  await loadAssessment(req, aid); // permission check
  const { rows } = await query('SELECT photo_path FROM assessments WHERE id = $1', [aid]);
  if (!rows[0]?.photo_path) throw new HttpError(404, 'No photo for this assessment.');
  const buf = await readFile(photoFullPath(rows[0].photo_path));
  res.set('Content-Type', sniffImageType(buf) || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(buf);
}));

standalone.delete('/:id', wrap(async (req, res) => {
  const aid = id(req.params.id);
  const a = await loadAssessment(req, aid);
  const done = await query(`SELECT 1 FROM device_actions WHERE device_id = $1 AND status = 'completed' LIMIT 1`, [a.device_id]);
  if (done.rowCount && req.user.role !== 'admin') {
    throw new HttpError(409, 'This device has a completed action, so its assessments are kept as part of the record.');
  }
  const { rows } = await query('DELETE FROM assessments WHERE id = $1 RETURNING photo_path, device_id', [aid]);
  await removePhotoFile(rows[0]?.photo_path);
  await syncDeviceStatus(a.device_id);
  res.status(204).end();
}));

// ---- Feedback: how useful was this recommendation? (feeds the AI usefulness metrics) ------------------------
const ACTIONS = ['repair', 'reuse', 'donate', 'parts_recovery', 'recycle'];

async function loadOwnAssessment(req, assessmentId) {
  const { rows } = await query('SELECT id, user_id FROM (SELECT a.id, d.user_id FROM assessments a JOIN devices d ON d.id = a.device_id) WHERE id = $1', [assessmentId]);
  if (!rows[0] || rows[0].user_id !== req.user.id) throw new HttpError(404, 'Assessment not found.');
}

standalone.get('/:id/feedback', wrap(async (req, res) => {
  const aid = id(req.params.id);
  await loadOwnAssessment(req, aid);
  const { rows } = await query('SELECT rating, will_follow, chosen_action, comment, updated_at FROM ai_feedback WHERE assessment_id = $1', [aid]);
  res.json(rows[0] || null);
}));

standalone.put('/:id/feedback', wrap(async (req, res) => {
  const aid = id(req.params.id);
  await loadOwnAssessment(req, aid);
  const rating = numberIn(req.body.rating, 'Rating', 1, 5);
  if (!Number.isInteger(rating)) throw new HttpError(400, 'Rating must be a whole number from 1 to 5.');
  const willFollow = oneOf(req.body.will_follow, 'Will follow', ['yes', 'partly', 'no']);
  const chosen = req.body.chosen_action ? oneOf(req.body.chosen_action, 'Chosen action', ACTIONS) : null;
  const comment = str(req.body.comment, 'Comment', { max: 500, optional: true });
  const { rows } = await query(
    `INSERT INTO ai_feedback (assessment_id, user_id, rating, will_follow, chosen_action, comment)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT(assessment_id) DO UPDATE SET rating = excluded.rating, will_follow = excluded.will_follow,
       chosen_action = excluded.chosen_action, comment = excluded.comment, updated_at = now()
     RETURNING rating, will_follow, chosen_action, comment, updated_at`,
    [aid, req.user.id, rating, willFollow, chosen, comment]
  );
  res.json(rows[0]);
}));
