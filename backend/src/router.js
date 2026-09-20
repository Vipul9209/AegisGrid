// Transport-agnostic router. Used by the local HTTP server and by the AWS Lambda handler.
import { createStore } from './store.js';
import { createService } from './service.js';
import { login, userFromToken, demoAccounts } from './auth.js';
import { capabilities, authorize } from './authz.js';

const store = createStore();
export const service = createService(store);
let seeded = false;
const ensureSeeded = async () => {
  if (seeded) return;
  seeded = true;
  await service.seedBackground();
};

const ok = (body, status = 200) => ({ status, body });
const fail = (r) => ({ status: r.status ?? 400, body: { error: r.error, reasons: r.reasons, emergency: r.emergency } });
const done = (r, body = r) => (r.error ? fail(r) : ok(body, r.status ?? 200));

const bearer = (headers) => {
  const h = headers.authorization ?? headers.Authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

export async function handle({ method, path, body = {}, headers = {}, ip = 'local' }) {
  await ensureSeeded();
  const p = path.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const seg = p.split('/').filter(Boolean);

  // ---- public ----
  if (method === 'GET' && p === '/health') return ok({ ok: true });
  if (method === 'GET' && p === '/auth/demo') return ok(demoAccounts());
  if (method === 'POST' && p === '/auth/login') {
    const r = login(body.username, body.password, ip);
    return r.error ? fail(r) : ok({ token: r.token, user: r.user, capabilities: capabilities(r.user) });
  }

  // ---- facility systems pushing data (API key, not a user session) ----
  if (method === 'POST' && seg[0] === 'ingest' && seg[1] === 'facilities' && seg[2] && seg[3] === 'inventory') {
    const key = process.env.INGEST_KEY;
    if (!key) return ok({ error: 'Ingest API is not enabled on this deployment.' }, 404);
    if ((headers['x-ingest-key'] ?? headers['X-Ingest-Key']) !== key) return ok({ error: 'Invalid ingest key.' }, 401);
    const system = { id: `system-${seg[2]}`, name: `${seg[2]} hospital system`, role: 'facility_system', kind: 'user', facility: seg[2] };
    return done(service.updateInventory(seg[2], body, system, 'ingest API'));
  }

  // ---- everything below needs a signed-in user ----
  const user = userFromToken(bearer(headers));
  if (!user) return ok({ error: 'Sign in to continue.' }, 401);

  if (method === 'GET' && p === '/auth/me') return ok({ user, capabilities: capabilities(user) });
  if (method === 'GET' && p === '/facilities') return ok(store.facilities);
  if (method === 'GET' && p === '/network') return ok(service.network());
  if (method === 'GET' && seg[0] === 'facilities' && seg[1] && seg.length === 2) {
    const d = service.facilityDetail(seg[1]);
    return d ? ok(d) : ok({ error: 'Facility not found.' }, 404);
  }
  if (method === 'POST' && seg[0] === 'facilities' && seg[2] === 'inventory') return done(service.updateInventory(seg[1], body, user));
  if (method === 'GET' && p === '/dashboard') return ok(service.dashboard());
  if (method === 'GET' && p === '/audit') return ok(service.audit());
  if (method === 'GET' && p === '/policies') return ok(service.POLICIES);
  if (method === 'GET' && p === '/events') {
    const mine = user.role === 'facility_admin';
    return ok({
      events: store.events.slice(-60).reverse(),
      outbox: store.outbox.filter((m) => !mine || m.facilityId === user.facility).slice(-40).reverse(),
    });
  }

  if (method === 'POST' && seg[0] === 'resources' && seg[2] === 'status') return done(service.setResourceStatus(seg[1], body.status, user));

  if (method === 'GET' && p === '/emergencies') return ok([...store.emergencies.values()].reverse().map((e) => service.view(e)));
  if (method === 'POST' && p === '/emergencies') {
    const r = await service.createEmergency({ text: body.text, originFacilityId: body.originFacilityId, timeLimitMin: Number(body.timeLimitMin) }, user);
    return r.error ? fail(r) : ok(r.emergency, 201);
  }
  if (seg[0] === 'emergencies' && seg[1]) {
    const em = store.emergencies.get(seg[1]);
    if (!em) return ok({ error: 'Emergency not found.' }, 404);
    if (method === 'GET' && seg.length === 2) return ok(service.view(em));
    if (method === 'POST' && seg[2] === 'whatif') return ok(service.whatIf(em, Array.isArray(body.exclude) ? body.exclude : []));
    if (method === 'POST' && seg[2] === 'approve') return done(service.approve(em.id, body.planId, user));
    if (method === 'POST' && seg[2] === 'acknowledge') return done(service.acknowledge(em.id, body.facilityId, body.decision, user));
    if (method === 'POST' && seg[2] === 'cancel') return done(service.cancel(em.id, user, body.reason));
  }
  if (method === 'POST' && p === '/reset') {
    const d = authorize({ principal: user, action: 'ResetDemo', resource: { type: 'Network', id: 'network' } });
    if (!d.allowed) return ok({ error: 'Cedar policy blocked resetting the network.', reasons: d.reasons }, 403);
    service.reset();
    seeded = false;
    await ensureSeeded();
    return ok({ ok: true });
  }
  return ok({ error: 'Not found' }, 404);
}
