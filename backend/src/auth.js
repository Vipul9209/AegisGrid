// Sessions: scrypt-hashed passwords + HMAC-signed tokens (no external service, works offline).
// In production this layer is replaced by Amazon Cognito; the rest of the app only sees {id, role, facility}.
import crypto from 'node:crypto';
import { FACILITIES } from './data/seed.js';

const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'); // random per boot if unset
const TTL_MS = 12 * 3600 * 1000;
export const DEMO_MODE = process.env.DEMO_MODE !== 'off';
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'aegis@2026';

const hashPassword = (pw, salt = crypto.randomBytes(16)) => `${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
function checkPassword(pw, stored) {
  const [saltHex, hashHex] = stored.split('$');
  const h = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
  const want = Buffer.from(hashHex, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}

const PW_HASH = hashPassword(DEMO_PASSWORD); // all seeded accounts share one demo password

const people = [
  { username: 'meera.rao', name: 'Dr. Meera Rao', title: 'Duty doctor', role: 'duty_doctor', facility: 'F02' },
  { username: 'arjun.nair', name: 'Dr. Arjun Nair', title: 'Duty doctor', role: 'duty_doctor', facility: 'F01' },
  { username: 'rohan.iyer', name: 'Rohan Iyer', title: 'Regional dispatch lead', role: 'dispatch_lead', facility: 'NETWORK' },
  { username: 'viewer', name: 'Read-only observer', title: 'Observer', role: 'observer', facility: 'NETWORK' },
  { username: 'agent', name: 'AegisGrid AI agent', title: 'AI agent', role: 'ai_agent', kind: 'agent', facility: 'NETWORK' },
];
for (const f of FACILITIES) {
  people.push({ username: `admin.${f.id.toLowerCase()}`, name: `${f.name} facility desk`, title: 'Facility admin', role: 'facility_admin', facility: f.id });
}
const USERS = new Map(people.map((p) => [p.username, { ...p, kind: p.kind ?? 'user', hash: PW_HASH }]));

export const publicUser = (u) => ({ id: u.username, name: u.name, title: u.title, role: u.role, facility: u.facility, kind: u.kind });

export function demoAccounts() {
  if (!DEMO_MODE) return { enabled: false };
  const pick = ['meera.rao', 'rohan.iyer', 'admin.f07', 'admin.f17', 'viewer'];
  return { enabled: true, password: DEMO_PASSWORD, accounts: pick.map((u) => publicUser(USERS.get(u))) };
}

const b64 = (b) => Buffer.from(b).toString('base64url');
const mac = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

export function signToken(user) {
  const body = b64(JSON.stringify({ sub: user.username, exp: Date.now() + TTL_MS }));
  return `${body}.${mac(body)}`;
}

export function userFromToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const good = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Date.now()) return null;
    const u = USERS.get(p.sub);
    return u ? { id: u.username, name: u.name, title: u.title, role: u.role, facility: u.facility, kind: u.kind } : null;
  } catch {
    return null;
  }
}

// Naive in-memory brute-force guard: 8 failures per 5 minutes per (ip, username).
const fails = new Map();
export function login(username, password, ip = 'local') {
  const key = `${ip}|${String(username).toLowerCase()}`;
  const rec = fails.get(key);
  if (rec && rec.n >= 8 && Date.now() - rec.t < 300000) return { status: 429, error: 'Too many attempts. Wait a few minutes and try again.' };
  const u = USERS.get(String(username || '').trim().toLowerCase());
  const ok = checkPassword(String(password ?? ''), u ? u.hash : PW_HASH) && !!u; // constant-ish time either way
  if (!ok) {
    fails.set(key, { n: (rec && Date.now() - rec.t < 300000 ? rec.n : 0) + 1, t: Date.now() });
    return { status: 401, error: 'Username or password is incorrect.' };
  }
  fails.delete(key);
  return { status: 200, token: signToken(u), user: publicUser(u) };
}
