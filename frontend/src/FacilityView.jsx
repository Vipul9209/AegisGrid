import React, { useCallback, useEffect, useState } from 'react';
import { api, timeAgo } from './api.js';

const GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

export default function FacilityView({ user, caps, facilities, facilityId, setFacilityId, flash, refreshShell }) {
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [denial, setDenial] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (initForm = false) => {
    const r = await api(`/facilities/${facilityId}`);
    if (!r.ok) return;
    setDetail(r.data);
    if (initForm) {
      const inv = r.data.inventory;
      setForm({ icu: inv.icu.available, vent: inv.ventilators.available, amb: inv.ambulances.available, blood: { ...inv.blood } });
    }
  }, [facilityId]);

  useEffect(() => {
    setDetail(null);
    setForm(null);
    setDenial(null);
    load(true);
    const t = setInterval(() => load(false), 2000);
    return () => clearInterval(t);
  }, [load]);

  if (!detail || !form) return <div className="page"><p className="muted">Loading facility…</p></div>;
  const inv = detail.inventory;
  const mine = caps.inventory && user.facility === facilityId;

  const save = async () => {
    setBusy(true);
    setDenial(null);
    const r = await api(`/facilities/${facilityId}/inventory`, { method: 'POST', body: { icuBedsAvailable: form.icu, ventilatorsAvailable: form.vent, ambulancesAvailable: form.amb, blood: form.blood } });
    setBusy(false);
    if (r.status === 403) return setDenial(r.data);
    if (!r.ok) return flash(r.data.error);
    flash('Inventory updated. Every dashboard now sees the new numbers.');
    await load(true);
    refreshShell();
  };

  const answer = async (req, decision) => {
    const r = await api(`/emergencies/${req.emergencyId}/acknowledge`, { method: 'POST', body: { facilityId, decision } });
    if (!r.ok) return flash(r.data.error || (r.data.reasons ?? []).join(' '));
    flash(decision === 'ACCEPT' ? 'Confirmed.' : 'Declined. The plan was sent back for replanning.');
    load(false);
    refreshShell();
  };

  const num = (v, max) => Math.max(0, Math.min(max, Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0));
  const pending = detail.requests.filter((r) => r.status === 'PENDING');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>{detail.name}</h2>
          <p>
            {detail.connected ? `Data synced ${detail.ageMin === 0 ? 'just now' : `${detail.ageMin} min ago`}` : `Data feed disconnected, last synced ${detail.ageMin} min ago`}. Phone {detail.phone}.
          </p>
        </div>
        <label className="fac-select">
          Facility
          <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      </header>

      {detail.stale && <div className="banner bad" role="alert">This facility's data is stale. Plans that depend on it are flagged for phone confirmation.</div>}

      <section className="panel" aria-label="Incoming requests">
        <h3>Incoming requests {pending.length > 0 && <span className="pill warn">{pending.length} waiting</span>}</h3>
        {detail.requests.length === 0 ? <p className="muted">No open requests. When a plan uses this facility, the request appears here.</p> : (
          <ul className="req-list">
            {detail.requests.map((r) => (
              <li key={r.emergencyId}>
                <div>
                  <b>{r.emergencyId} · {r.condition}</b>
                  <span>{r.summary ? r.summary[0].toUpperCase() + r.summary.slice(1) : ''}. Treatment site: {r.targetName}. Needed within {r.responseMin} min.</span>
                </div>
                {r.status === 'PENDING' ? (
                  mine ? (
                    <span className="ack-actions">
                      <button className="primary small" onClick={() => answer(r, 'ACCEPT')}>Confirm we can do this</button>
                      <button className="ghost small danger" onClick={() => answer(r, 'DECLINE')}>Decline</button>
                    </span>
                  ) : <span className="pill warn">Waiting for facility</span>
                ) : <span className="pill ok">Confirmed</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-label="Inventory">
        <div className="panel-head">
          <h3>Inventory</h3>
          {!mine && <span className="muted">Read-only. Only this facility's desk can edit it.</span>}
        </div>
        <div className="inv-grid">
          {[
            ['ICU beds free', 'icu', inv.icu],
            ['Ventilators free', 'vent', inv.ventilators],
            ['Ambulances free', 'amb', inv.ambulances],
          ].map(([label, key, c]) => (
            <label key={key} className="inv-card">
              <span>{label}</span>
              {mine ? <input type="number" min="0" max={c.total - c.reserved - c.offline} value={form[key]} onChange={(e) => setForm({ ...form, [key]: num(e.target.value, c.total - c.reserved - c.offline) })} /> : <b>{c.available}</b>}
              <small>of {c.total} total{c.reserved ? `, ${c.reserved} reserved for emergencies` : ''}{c.offline ? `, ${c.offline} offline` : ''}</small>
            </label>
          ))}
        </div>
        <h4>Blood stock (red cells, units)</h4>
        <div className="blood-grid">
          {GROUPS.map((g) => (
            <label key={g} className="blood-cell">
              <span>{g}</span>
              {mine ? <input type="number" min="0" max="200" value={form.blood[g]} onChange={(e) => setForm({ ...form, blood: { ...form.blood, [g]: num(e.target.value, 200) } })} /> : <b>{inv.blood[g]}</b>}
            </label>
          ))}
        </div>
        <h4>Specialists on the roster</h4>
        {inv.specialists.length === 0 ? <p className="muted">None on the roster.</p> : (
          <ul className="spec-list">{inv.specialists.map((s) => <li key={s.id}><b>{s.specialty[0].toUpperCase() + s.specialty.slice(1)}</b> <span className={`pill ${s.status === 'AVAILABLE' ? 'ok' : s.status === 'RESERVED' ? 'warn' : ''}`}>{s.status === 'AVAILABLE' ? 'available' : s.status === 'RESERVED' ? 'reserved' : 'busy'}</span></li>)}</ul>
        )}
        {mine && <button className="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Update inventory'}</button>}
        {denial && <div className="denial" role="alert"><b>{denial.error}</b><ul>{(denial.reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul></div>}
      </section>

      <section className="panel" aria-label="Facility activity">
        <h3>Recent activity</h3>
        {detail.activity.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ul className="feed events wide">{detail.activity.map((e) => <li key={e.id}><span>{e.text}</span><time>{timeAgo(e.ts)}</time></li>)}</ul>
        )}
      </section>
    </div>
  );
}
