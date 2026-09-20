const BASE = import.meta.env.VITE_API_BASE || '';
const KEY = 'aegis_token';

export const getToken = () => sessionStorage.getItem(KEY);
export const setToken = (t) => (t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY));

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'Cannot reach the AegisGrid API.' } };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) window.dispatchEvent(new Event('aegis-unauthorized'));
  return { ok: res.ok, status: res.status, data };
}

export const KIND = {
  ICU_BED: { name: 'ICU bed', short: 'ICU' },
  VENTILATOR: { name: 'Ventilator', short: 'Vent' },
  BLOOD: { name: 'Blood', short: 'Blood' },
  AMBULANCE: { name: 'Ambulance', short: 'Amb' },
  SPECIALIST: { name: 'Specialist', short: 'Spec' },
};

export const ROLE_LABEL = {
  duty_doctor: 'Duty doctor',
  dispatch_lead: 'Dispatch lead',
  facility_admin: 'Facility admin',
  observer: 'Observer',
  ai_agent: 'AI agent',
};

export const timeAgo = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};
