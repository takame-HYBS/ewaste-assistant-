// Integration test: starts the real API against a throwaway SQLite database and exercises
// login and every module over HTTP (register/login, Devices CRUD, permissions, recommendations,
// actions, locations, stats, admin). Run with:  npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Use a temporary database so running the tests never touches your real data.
const serverDir = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'ewaste-test-'));
process.env.OTP_REQUIRED = 'false'; // the OTP flow has its own tests (otp.test.js)
process.env.DB_PATH = join(tmp, 'test.db');
process.env.UPLOAD_DIR = join(tmp, 'uploads');
for (const script of ['migrate', 'seed']) {
  execFileSync(process.execPath, [...process.execArgv, '--no-warnings', join(serverDir, 'src', 'db', `${script}.js`)], {
    env: process.env, stdio: 'ignore',
  });
}
const { createApp } = await import('../src/index.js');


let server, base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, { token, body, expect } = {}) {
  const res = await fetch(base + '/api' + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  assert.notEqual(res.status, 500, `${method} ${path} returned 500: ${text}`);
  if (expect) assert.equal(res.status, expect, `${method} ${path} -> ${res.status} ${text}`);
  return { status: res.status, data };
}

const reg = async (name, email, role = 'user') =>
  (await call('POST', '/auth/register', { body: { name, email, password: 'password123', role }, expect: 201 })).data;

let admin, alice, bob, partner, cats;

test('health + seeded admin can sign in', async () => {
  await call('GET', '/health', { expect: 200 });
  const r = await call('POST', '/auth/login', { body: { email: 'admin@example.com', password: 'ChangeMe!123' }, expect: 200 });
  admin = r.data;
  assert.equal(admin.user.role, 'admin');
  assert.ok(admin.token);
});

test('AUTH: register, duplicate, validation', async () => {
  alice = await reg('Alice', 'alice@x.io');
  assert.equal(alice.user.role, 'user');
  assert.equal(alice.user.password_hash, undefined, 'must not leak password hash');
  bob = await reg('Bob', 'bob@x.io');
  partner = await reg('Pat', 'pat@x.io', 'partner');
  assert.equal(partner.user.role, 'partner');

  await call('POST', '/auth/register', { body: { name: 'A2', email: 'ALICE@x.io', password: 'password123' }, expect: 409 }); // case-insensitive dup
  await call('POST', '/auth/register', { body: { name: 'X', email: 'x@x.io', password: 'short' }, expect: 400 });
  await call('POST', '/auth/register', { body: { name: 'X', email: 'not-an-email', password: 'password123' }, expect: 400 });
  await call('POST', '/auth/register', { body: { name: '', email: 'y@x.io', password: 'password123' }, expect: 400 });
  await call('POST', '/auth/register', { body: { name: 'Evil', email: 'evil@x.io', password: 'password123', role: 'admin' }, expect: 400 });
});

test('AUTH: login, me, wrong password, bad token', async () => {
  const ok = await call('POST', '/auth/login', { body: { email: 'alice@x.io', password: 'password123' }, expect: 200 });
  assert.equal(ok.data.user.email, 'alice@x.io');
  await call('POST', '/auth/login', { body: { email: 'alice@x.io', password: 'wrongpass' }, expect: 401 });
  await call('POST', '/auth/login', { body: { email: 'nobody@x.io', password: 'password123' }, expect: 401 });
  const me = await call('GET', '/auth/me', { token: alice.token, expect: 200 });
  assert.equal(me.data.user.name, 'Alice');
  await call('GET', '/auth/me', { expect: 401 });
  await call('GET', '/auth/me', { token: 'garbage.token.here', expect: 401 });
});

test('AUTH: login is throttled after repeated failures', async () => {
  for (let i = 0; i < 10; i++) await call('POST', '/auth/login', { body: { email: 'throttle@x.io', password: 'nope-nope' }, expect: 401 });
  await call('POST', '/auth/login', { body: { email: 'throttle@x.io', password: 'nope-nope' }, expect: 429 });
});

test('categories are public and seeded', async () => {
  const r = await call('GET', '/categories', { expect: 200 });
  cats = Object.fromEntries(r.data.map((c) => [c.key, c]));
  assert.deepEqual(Object.keys(cats).sort(), ['laptop', 'peripheral', 'phone', 'tablet']);
  assert.equal(typeof cats.phone.has_battery, 'boolean');
});

let phone;
test('DEVICES CRUD: unauthenticated access is refused', async () => {
  await call('GET', '/devices', { expect: 401 });
  await call('POST', '/devices', { body: {}, expect: 401 });
});

test('DEVICES CRUD: create + validation', async () => {
  const body = { category_id: cats.phone.id, brand: 'Samsung', model: 'A12', age_years: 3, condition: 'minor_issues', description: 'Cracked corner' };
  const r = await call('POST', '/devices', { token: alice.token, body, expect: 201 });
  phone = r.data;
  assert.equal(phone.brand, 'Samsung');
  assert.equal(phone.category_key, 'phone');
  assert.equal(phone.status, 'registered');
  assert.equal(phone.user_id, alice.user.id);

  await call('POST', '/devices', { token: alice.token, body: { ...body, brand: '' }, expect: 400 });
  await call('POST', '/devices', { token: alice.token, body: { ...body, age_years: -1 }, expect: 400 });
  await call('POST', '/devices', { token: alice.token, body: { ...body, age_years: 'abc' }, expect: 400 });
  await call('POST', '/devices', { token: alice.token, body: { ...body, condition: 'broken' }, expect: 400 });
  await call('POST', '/devices', { token: alice.token, body: { ...body, category_id: 9999 }, expect: 400 });
});

test('DEVICES CRUD: read list + detail, scoped to owner', async () => {
  const mine = await call('GET', '/devices', { token: alice.token, expect: 200 });
  assert.equal(mine.data.length, 1);
  assert.equal((await call('GET', '/devices', { token: bob.token, expect: 200 })).data.length, 0);
  const detail = await call('GET', `/devices/${phone.id}`, { token: alice.token, expect: 200 });
  assert.deepEqual(detail.data.assessments, []);
  assert.deepEqual(detail.data.actions, []);
  await call('GET', `/devices/${phone.id}`, { token: bob.token, expect: 404 }); // not 403: don't reveal it exists
  await call('GET', `/devices/${phone.id}`, { token: admin.token, expect: 200 });
  await call('GET', '/devices/abc', { token: alice.token, expect: 404 });
  const all = await call('GET', '/devices?all=1', { token: admin.token, expect: 200 });
  assert.equal(all.data.length, 1);
  assert.equal((await call('GET', '/devices?all=1', { token: alice.token, expect: 200 })).data.length, 1); // ignored for non-admin
});

test('DEVICES CRUD: update, and others cannot change it', async () => {
  const body = { category_id: cats.phone.id, brand: 'Samsung', model: 'A12 Pro', age_years: 3.5, condition: 'major_issues', description: 'Screen dead' };
  const r = await call('PUT', `/devices/${phone.id}`, { token: alice.token, body, expect: 200 });
  assert.equal(r.data.model, 'A12 Pro');
  assert.equal(r.data.age_years, 3.5);
  assert.equal(r.data.condition, 'major_issues');
  await call('PUT', `/devices/${phone.id}`, { token: bob.token, body, expect: 404 });
  await call('PUT', `/devices/${phone.id}`, { token: alice.token, body: { ...body, condition: 'nope' }, expect: 400 });
  await call('DELETE', `/devices/${phone.id}`, { token: bob.token, expect: 404 });
});

let assessment;
test('ASSESSMENT: recommendation is created and device status follows', async () => {
  const r = await call('POST', `/devices/${phone.id}/assessments`, {
    token: alice.token, body: { answers: { powers_on: 'yes', screen_damage: 'dead', repair_quote: 1200, still_needed: 'yes' } }, expect: 201,
  });
  assessment = r.data;
  assert.ok(['repair', 'reuse', 'donate', 'parts_recovery', 'recycle'].includes(assessment.result_action));
  assert.ok(Array.isArray(assessment.explanation) && assessment.explanation.length > 0, 'explanations are returned as an array');
  assert.ok(Array.isArray(assessment.ranking));
  assert.ok(Array.isArray(assessment.nextSteps) && assessment.nextSteps.length > 0);
  assert.equal(assessment.repair_cost_source, 'user_quote');
  assert.equal((await call('GET', `/devices/${phone.id}`, { token: alice.token })).data.status, 'assessed');
  await call('GET', `/assessments/${assessment.id}`, { token: alice.token, expect: 200 });
  await call('GET', `/assessments/${assessment.id}`, { token: bob.token, expect: 404 });
  await call('POST', `/devices/${phone.id}/assessments`, { token: alice.token, body: { answers: { water_damage: 'maybe' } }, expect: 400 });
});

test('ASSESSMENT: swollen battery forces a safe result', async () => {
  const r = await call('POST', `/devices/${phone.id}/assessments`, { token: alice.token, body: { answers: { battery_swollen: 'yes' } }, expect: 201 });
  assert.equal(r.data.result_action, 'recycle');
  assert.ok(r.data.safety_notes.some((n) => /fire hazard/i.test(n)));
});

test('ACTIONS: record, status follows, completed record is protected', async () => {
  const r = await call('POST', `/devices/${phone.id}/actions`, { token: alice.token, body: { action: 'repair', status: 'planned', assessment_id: assessment.id }, expect: 201 });
  const act = r.data;
  assert.equal((await call('GET', `/devices/${phone.id}`, { token: alice.token })).data.status, 'in_progress');
  await call('POST', `/devices/${phone.id}/actions`, { token: alice.token, body: { action: 'fly' }, expect: 400 });
  await call('POST', `/devices/${phone.id}/actions`, { token: alice.token, body: { action: 'repair', action_date: '31/12/2026' }, expect: 400 });
  await call('PUT', `/actions/${act.id}`, { token: bob.token, body: { status: 'completed' }, expect: 404 });

  const done = await call('PUT', `/actions/${act.id}`, { token: alice.token, body: { status: 'completed', notes: 'Fixed at shop' }, expect: 200 });
  assert.equal(done.data.status, 'completed');
  assert.match(done.data.action_date, /^\d{4}-\d{2}-\d{2}$/, 'date is a plain YYYY-MM-DD string');
  assert.equal((await call('GET', `/devices/${phone.id}`, { token: alice.token })).data.status, 'completed');

  // locked: owner can't edit/delete a completed device or action
  const dev = { category_id: cats.phone.id, brand: 'X', model: '', age_years: 1, condition: 'working' };
  await call('PUT', `/devices/${phone.id}`, { token: alice.token, body: dev, expect: 409 });
  await call('DELETE', `/devices/${phone.id}`, { token: alice.token, expect: 409 });
  await call('DELETE', `/actions/${act.id}`, { token: alice.token, expect: 409 });
  const note = await call('PUT', `/actions/${act.id}`, { token: alice.token, body: { status: 'cancelled', notes: 'only notes change' }, expect: 200 });
  assert.equal(note.data.status, 'completed', 'status of a completed action cannot be changed by the owner');
  assert.equal(note.data.notes, 'only notes change');
});

test('STATS: counts completed actions', async () => {
  const s = await call('GET', '/stats', { token: alice.token, expect: 200 });
  assert.equal(s.data.completed, 1);
  assert.equal(s.data.actions.repair, 1);
  assert.equal(s.data.totalDevices, 1);
  assert.equal(s.data.deviceStatus.completed, 1);
  assert.equal(s.data.keptInUse, 1);
  assert.equal(s.data.monthly.length, 1);
  assert.equal(typeof s.data.completed, 'number');
  assert.equal((await call('GET', '/stats?scope=all', { token: admin.token, expect: 200 })).data.scope, 'all');
  assert.equal((await call('GET', '/stats?scope=all', { token: alice.token, expect: 200 })).data.scope, 'mine');
});

test('DEVICES CRUD: delete (owner) and it is really gone', async () => {
  const d = (await call('POST', '/devices', { token: bob.token, expect: 201,
    body: { category_id: cats.laptop.id, brand: 'Dell', model: '', age_years: 7, condition: 'not_working' } })).data;
  await call('POST', `/devices/${d.id}/assessments`, { token: bob.token, body: { answers: {} }, expect: 201 });
  await call('DELETE', `/devices/${d.id}`, { token: bob.token, expect: 204 });
  await call('GET', `/devices/${d.id}`, { token: bob.token, expect: 404 });
  assert.equal((await call('GET', '/devices', { token: bob.token })).data.length, 0);
});

let loc;
test('LOCATIONS: public sees verified only; partner listing needs approval', async () => {
  const pub = await call('GET', '/locations', { expect: 200 });
  assert.equal(pub.data.length, 3);
  assert.equal(typeof pub.data[0].verified, 'boolean');
  assert.ok(Array.isArray(pub.data[0].accepted_categories));

  assert.equal((await call('GET', '/locations?type=repair', { expect: 200 })).data.length, 1);
  assert.equal((await call('GET', '/locations?category=peripheral', { expect: 200 })).data.length, 2); // donation + all-accepting recycler
  assert.equal((await call('GET', '/locations?q=donation', { expect: 200 })).data.length, 1);

  const body = { name: 'Pat Repairs', type: 'repair', lat: 14.6, lng: 121, city: 'Manila', accepted_categories: ['phone'], website: 'https://pat.example' };
  await call('POST', '/locations', { token: alice.token, body, expect: 403 });
  await call('POST', '/locations', { token: partner.token, body: { ...body, lat: 200 }, expect: 400 });
  await call('POST', '/locations', { token: partner.token, body: { ...body, website: 'javascript:alert(1)' }, expect: 400 });
  loc = (await call('POST', '/locations', { token: partner.token, body, expect: 201 })).data;
  assert.equal(loc.verified, false);
  assert.equal((await call('GET', '/locations', { expect: 200 })).data.length, 3, 'unverified listing stays hidden');
  assert.equal((await call('GET', '/locations?mine=1', { token: partner.token, expect: 200 })).data.length, 1);
  await call('GET', `/locations/${loc.id}`, { expect: 404 });

  await call('POST', `/locations/${loc.id}/verify`, { token: partner.token, body: {}, expect: 403 });
  const v = await call('POST', `/locations/${loc.id}/verify`, { token: admin.token, body: {}, expect: 200 });
  assert.equal(v.data.verified, true);
  assert.equal((await call('GET', '/locations', { expect: 200 })).data.length, 4);
});

test('LOCATIONS: partner edit re-queues review; report flow; delete', async () => {
  const body = { name: 'Pat Repairs 2', type: 'repair', lat: 14.6, lng: 121, accepted_categories: [] };
  const e = await call('PUT', `/locations/${loc.id}`, { token: partner.token, body, expect: 200 });
  assert.equal(e.data.verified, false);
  await call('PUT', `/locations/${loc.id}`, { token: bob.token, body, expect: 403 });
  await call('POST', `/locations/${loc.id}/verify`, { token: admin.token, body: {}, expect: 200 });

  await call('POST', `/locations/${loc.id}/report`, { body: { note: 'closed' }, expect: 401 });
  await call('POST', `/locations/${loc.id}/report`, { token: bob.token, body: { note: 'Closed down' }, expect: 202 });
  assert.equal((await call('GET', '/locations', { expect: 200 })).data.length, 3, 'reported listing hidden from public');
  const reports = await call('GET', '/admin/reports', { token: admin.token, expect: 200 });
  assert.equal(reports.data.length, 1);
  await call('POST', `/admin/reports/${loc.id}/dismiss`, { token: admin.token, expect: 200 });
  assert.equal((await call('GET', '/locations', { expect: 200 })).data.length, 4);

  await call('DELETE', `/locations/${loc.id}`, { token: bob.token, expect: 403 });
  await call('DELETE', `/locations/${loc.id}`, { token: partner.token, expect: 204 });
});

test('ADMIN: users, roles, protections', async () => {
  await call('GET', '/admin/users', { token: alice.token, expect: 403 });
  await call('GET', '/admin/users', { expect: 401 });
  const users = await call('GET', '/admin/users', { token: admin.token, expect: 200 });
  assert.equal(users.data.length, 4);
  assert.equal(users.data.find((u) => u.email === 'alice@x.io').device_count, 1);
  assert.equal(typeof users.data[0].active, 'boolean');

  const adminId = users.data.find((u) => u.email === 'admin@example.com').id;
  await call('PUT', `/admin/users/${adminId}`, { token: admin.token, body: { role: 'user' }, expect: 409 });       // last admin
  await call('PUT', `/admin/users/${adminId}`, { token: admin.token, body: { active: false }, expect: 409 });
  await call('DELETE', `/admin/users/${adminId}`, { token: admin.token, expect: 409 });
  await call('DELETE', `/admin/users/${alice.user.id}`, { token: admin.token, expect: 409 });                      // owns devices

  const off = await call('PUT', `/admin/users/${bob.user.id}`, { token: admin.token, body: { active: false }, expect: 200 });
  assert.equal(off.data.active, false);
  await call('POST', '/auth/login', { body: { email: 'bob@x.io', password: 'password123' }, expect: 401 });
  await call('GET', '/auth/me', { token: bob.token, expect: 401 }); // existing token stops working immediately
  await call('DELETE', `/admin/users/${bob.user.id}`, { token: admin.token, expect: 204 });

  const made = await call('POST', '/admin/users', { token: admin.token, body: { name: 'Second Admin', email: 'a2@x.io', password: 'password123', role: 'admin' }, expect: 201 });
  assert.equal(made.data.role, 'admin');
  await call('PUT', `/admin/users/${adminId}`, { token: admin.token, body: { role: 'user' }, expect: 200 }); // now allowed
});

test('CATEGORIES: admin CRUD; in-use category cannot be deleted', async () => {
  const a2 = (await call('POST', '/auth/login', { body: { email: 'a2@x.io', password: 'password123' }, expect: 200 })).data;
  await call('POST', '/categories', { token: alice.token, body: { key: 'x', label: 'X' }, expect: 403 });
  const c = (await call('POST', '/categories', { token: a2.token, body: { key: 'Camera!', label: 'Camera', typical_lifespan_years: 7 }, expect: 201 })).data;
  assert.equal(c.key, 'camera_');
  await call('POST', '/categories', { token: a2.token, body: { key: 'camera_', label: 'Dup' }, expect: 409 });
  await call('PUT', `/categories/${c.id}`, { token: a2.token, body: { ...c, label: 'Cameras', active: false }, expect: 200 });
  assert.ok(!(await call('GET', '/categories', { expect: 200 })).data.some((x) => x.key === 'camera_'), 'inactive hidden from public');
  await call('DELETE', `/categories/${c.id}`, { token: a2.token, expect: 204 });
  await call('DELETE', `/categories/${cats.phone.id}`, { token: a2.token, expect: 409 }); // alice's phone uses it
});

test('unknown API route and bad JSON are handled', async () => {
  await call('GET', '/nope', { expect: 404 });
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------------------------------------------
// AI component
// ---------------------------------------------------------------------------------------------------------------
let carol, admin2;
test('AI: every recommendation carries a model prediction, probabilities and a repair score', async () => {
  const a = (await call('GET', `/assessments/${assessment.id}`, { token: alice.token, expect: 200 })).data;
  assert.ok(a.ai, 'ai block present');
  assert.equal(a.decision_source, 'ai');
  const probs = Object.values(a.ai.probabilities);
  assert.equal(probs.length, 5);
  assert.ok(Math.abs(probs.reduce((x, y) => x + y, 0) - 1) < 0.01);
  assert.equal(typeof a.ai.repairScore, 'number');
  assert.ok(a.ai.factors.length > 0 && a.ai.factors[0].text);
  assert.equal(a.result_action, a.ai.action, 'the AI makes the final decision when there is no hazard');
  assert.ok(a.rule_action, 'rule-engine second opinion is stored');
  assert.equal(typeof a.ai.agreesWithRules, 'boolean');
  assert.ok(Array.isArray(a.explanation), 'rule reasoning is still returned');
});

test('AI: a safety hazard overrides the model', async () => {
  const r = await call('POST', `/devices/${phone.id}/assessments`, { token: alice.token, body: { answers: { battery_swollen: 'yes', still_needed: 'yes' } }, expect: 201 });
  assert.equal(r.data.decision_source, 'safety_override');
  assert.equal(r.data.result_action, 'recycle');
  assert.ok(r.data.ai, 'the model still ran, so the disagreement is visible');
  assert.ok(r.data.safety_notes.length > 0);
});

test('AI FEEDBACK: owner can rate, update (not duplicate), and invalid input is refused', async () => {
  const path = `/assessments/${assessment.id}/feedback`;
  await call('GET', path, { expect: 401 });
  assert.equal((await call('GET', path, { token: alice.token, expect: 200 })).data, null);

  const body = { rating: 5, will_follow: 'yes', chosen_action: assessment.result_action, comment: 'Clear and helpful' };
  const saved = await call('PUT', path, { token: alice.token, body, expect: 200 });
  assert.equal(saved.data.rating, 5);
  assert.equal((await call('GET', path, { token: alice.token, expect: 200 })).data.comment, 'Clear and helpful');

  await call('PUT', path, { token: alice.token, body: { ...body, rating: 6 }, expect: 400 });
  await call('PUT', path, { token: alice.token, body: { ...body, rating: 0 }, expect: 400 });
  await call('PUT', path, { token: alice.token, body: { ...body, rating: 2.5 }, expect: 400 });
  await call('PUT', path, { token: alice.token, body: { ...body, will_follow: 'maybe' }, expect: 400 });
  await call('PUT', path, { token: alice.token, body: { ...body, chosen_action: 'fly' }, expect: 400 });
  await call('PUT', path, { token: alice.token, body: { ...body, comment: 'x'.repeat(501) }, expect: 400 });

  const updated = await call('PUT', path, { token: alice.token, body: { ...body, rating: 4 }, expect: 200 });
  assert.equal(updated.data.rating, 4);

  carol = await reg('Carol', 'carol@x.io');
  await call('PUT', path, { token: carol.token, body, expect: 404 });   // someone else's assessment
  await call('GET', path, { token: carol.token, expect: 404 });
});

test('AI USEFULNESS: public aggregate reflects the feedback exactly', async () => {
  const u = (await call('GET', '/ai/usefulness', { expect: 200 })).data;
  assert.ok(u.recommendationsWithAi >= 3);
  assert.equal(u.feedback.n, 1, 'the update did not create a second row');
  assert.equal(u.feedback.averageRating, 4);
  assert.equal(u.feedback.shareRated4or5, 1);
  assert.equal(u.feedback.ratings[4], 1);
  assert.equal(u.feedback.willFollow.yes, 1);
  assert.equal(u.feedback.willFollowYesRate, 1);
  assert.equal(u.chosenMatchesRecommendation.n, 1);
  assert.equal(u.chosenMatchesRecommendation.rate, 1);
  assert.equal(u.completedMatchesRecommendation.n, 1);
  assert.ok(u.decidedBy.ai >= 1 && u.decidedBy.safety_override >= 1);
  assert.ok(u.aiAgreesWithRules.rate >= 0 && u.aiAgreesWithRules.rate <= 1);
  assert.equal(JSON.stringify(u).includes('alice'), false, 'no personal data in the public aggregate');
});

test('AI MODEL: public model card includes the offline evaluation', async () => {
  const m = (await call('GET', '/ai/model', { expect: 200 })).data;
  assert.equal(m.available, true);
  assert.ok(m.model.version && m.model.algorithm);
  assert.equal(typeof m.model.evaluation.heldOutSynthetic.model.accuracy, 'number');
  assert.equal(m.model.evaluation.heldOutSynthetic.model.confusion.matrix.length, 5);
});

test('AI EXPORT: only admins can download real labelled cases, and they hold no personal data', async () => {
  admin2 = (await call('POST', '/auth/login', { body: { email: 'a2@x.io', password: 'password123' }, expect: 200 })).data;
  await call('GET', '/ai/real-cases.csv', { expect: 401 });
  await call('GET', '/ai/real-cases.csv', { token: alice.token, expect: 403 });
  const csv = (await call('GET', '/ai/real-cases.csv', { token: admin2.token, expect: 200 })).data;
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'category,age_years,lifespan_years,condition,powers_on,screen_damage,water_damage,battery_swollen,battery_health,software_supported,still_needed,cosmetic_only,repair_quote,label,source');
  assert.equal(lines.length, 2, 'one real case: the assessment that has a completed action');
  assert.match(lines[1], /,repair,real_completed$/);
  assert.equal(/alice|@x\.io/i.test(csv), false);
});
