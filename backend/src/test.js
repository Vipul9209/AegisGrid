import assert from 'node:assert/strict';
import { handle } from './router.js';

let token = null;
const call = (method, path, body) => handle({ method, path, body, headers: token ? { authorization: `Bearer ${token}` } : {} });
const as = async (username) => {
  const r = await handle({ method: 'POST', path: '/api/auth/login', body: { username, password: 'aegis@2026' }, ip: 'test' });
  assert.equal(r.status, 200, `login ${username}`);
  token = r.body.token;
  return r.body;
};

// --- auth ---
token = null;
assert.equal((await call('GET', '/api/dashboard')).status, 401, 'no token is rejected');
assert.equal((await handle({ method: 'POST', path: '/api/auth/login', body: { username: 'meera.rao', password: 'nope' }, ip: 'test2' })).status, 401);
const me = await as('meera.rao');
console.log('doctor caps', JSON.stringify(me.capabilities));
assert.equal(me.capabilities.approve, true);
assert.equal((await as('viewer')).capabilities.create, false);
assert.equal((await as('admin.f07')).capabilities.inventory, true);
console.log('login/caps OK');

// --- emergency + plans ---
await as('meera.rao');
const created = await call('POST', '/api/emergencies', { text: 'Critical trauma after road accident, needs blood, ICU, ventilator, ambulance and trauma specialist within 30 minutes', originFacilityId: 'F04' });
assert.equal(created.status, 201);
const em = created.body;
const A = em.planning.plans[0];
for (const p of em.planning.plans) console.log(' ', p.name, p.targetName, p.status, p.responseMin + 'min', p.warnings.map((w) => w.name + ' stale').join(','));
assert.equal(A.feasible, true);

// --- Cedar checks ---
await as('viewer');
assert.equal((await call('POST', '/api/emergencies', { text: 'test emergency', originFacilityId: 'F04' })).status, 403, 'observer cannot create');
assert.equal((await call('POST', `/api/emergencies/${em.id}/approve`, { planId: A.id })).status, 403, 'observer cannot approve');
await as('agent');
assert.equal((await call('POST', `/api/emergencies/${em.id}/approve`, { planId: A.id })).status, 403, 'agent cannot approve');
await as('rohan.iyer');
const dl = await call('POST', `/api/emergencies/${em.id}/approve`, { planId: A.id });
console.log('dispatch lead approve', dl.status, dl.body.reasons);
assert.equal(dl.status, 403, 'O-negative needs a duty doctor');
await as('admin.f07');
assert.equal((await call('POST', `/api/emergencies/${em.id}/approve`, { planId: A.id })).status, 403, 'facility admin cannot approve');
console.log('Cedar denials OK');

// --- approve, acks ---
await as('meera.rao');
const ok = await call('POST', `/api/emergencies/${em.id}/approve`, { planId: A.id });
assert.equal(ok.status, 200);
console.log('acks', ok.body.emergency.acks.map((a) => `${a.name}:${a.status}`));
// wrong facility desk cannot answer for another facility
await as('admin.f01');
assert.equal((await call('POST', `/api/emergencies/${em.id}/acknowledge`, { facilityId: 'F07', decision: 'ACCEPT' })).status, 403, 'cannot answer for another facility');
await as('admin.f07');
const acc = await call('POST', `/api/emergencies/${em.id}/acknowledge`, { facilityId: 'F07', decision: 'ACCEPT' });
assert.equal(acc.status, 200);
const fd = (await call('GET', '/api/facilities/F07')).body;
console.log('F07 requests', fd.requests.map((r) => `${r.emergencyId}:${r.status}`));

// --- inventory ---
const before = fd.inventory.icu.available;
const inv = await call('POST', '/api/facilities/F07/inventory', { icuBedsAvailable: before + 1, blood: { 'O-': 9 } });
console.log('inventory update', inv.status, inv.body.facility?.inventory?.icu, inv.body.facility?.inventory?.blood['O-']);
assert.equal(inv.status, 200);
assert.equal((await call('POST', '/api/facilities/F01/inventory', { icuBedsAvailable: 1 })).status, 403, 'cannot edit other facility');
assert.equal((await call('POST', '/api/facilities/F07/inventory', { icuBedsAvailable: -3 })).status, 400);

// --- decline -> replan ---
await as('admin.f17');
const dec = await call('POST', `/api/emergencies/${em.id}/acknowledge`, { facilityId: 'F17', decision: 'DECLINE' });
console.log('decline', dec.status, dec.body.emergency?.status, dec.body.emergency?.alert?.message);
assert.equal(dec.body.emergency.status, 'PLANNED');

// --- ingest API ---
process.env.INGEST_KEY = 'k123';
const bad = await handle({ method: 'POST', path: '/api/ingest/facilities/F07/inventory', body: { icuBedsAvailable: 2 }, headers: { 'x-ingest-key': 'x' } });
assert.equal(bad.status, 401);
const good = await handle({ method: 'POST', path: '/api/ingest/facilities/F07/inventory', body: { icuBedsAvailable: 2 }, headers: { 'x-ingest-key': 'k123' } });
assert.equal(good.status, 200);

await as('meera.rao');
const net = (await call('GET', '/api/network')).body;
console.log('network', net.length, 'stale:', net.filter((f) => f.stale).map((f) => f.name));
console.log('audit lines', (await call('GET', '/api/audit')).body.length);
console.log('OK');
