import React, { useMemo, useState } from 'react';
import { KIND } from './api.js';

export const fmt = (n) => (n == null ? '–' : Math.round(n));

export function NeedChips({ needs }) {
  const chips = [];
  if (needs.icu) chips.push('ICU bed');
  if (needs.ventilator) chips.push('Ventilator');
  if (needs.blood) chips.push(`Blood ${needs.blood.group} x${needs.blood.units}${needs.blood.groupAssumed ? ' (group assumed)' : ''}`);
  if (needs.ambulance) chips.push('Ambulance');
  if (needs.specialist) chips.push(`${needs.specialist[0].toUpperCase()}${needs.specialist.slice(1)} specialist`);
  return (
    <ul className="chips" aria-label="Required resources">
      {chips.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  );
}

/* The time budget: every resource is a bar measured against the clock limit. */
export function ClockStrip({ plan, onWhatIf, activeExclude, readOnly }) {
  const max = Math.max(plan.timeLimitMin * 1.25, ...plan.legs.map((l) => l.etaMin * 1.06));
  const pct = (m) => `${Math.min(100, (m / max) * 100)}%`;
  return (
    <div className="strip" role="table" aria-label={`Time budget for ${plan.name}`}>
      <div className="strip-limit" style={{ left: `calc(var(--label-w) + (100% - var(--label-w) - var(--end-w)) * ${plan.timeLimitMin / max})` }}>
        <span>{plan.timeLimitMin} min limit</span>
      </div>
      {plan.legs.map((l) => {
        const over = Math.max(0, l.etaMin - plan.timeLimitMin);
        const within = l.etaMin - over;
        const isCritical = l.kind === plan.criticalKind;
        return (
          <div className={`strip-row ${isCritical ? 'critical' : ''} ${l.stale ? 'stale' : ''}`} role="row" key={l.resourceId}>
            <div className="strip-label" role="cell">
              <strong>{l.label}</strong>
              <span>{l.note}</span>
            </div>
            <div className="strip-track" role="cell">
              {l.kind === 'AMBULANCE' && <div className="bar bar-pickup" style={{ width: pct(Math.min(l.pickupMin, within)) }} title="Ambulance reaches the patient" />}
              <div className="bar bar-ok" style={{ width: pct(within - (l.kind === 'AMBULANCE' ? Math.min(l.pickupMin, within) : 0)) }} />
              {over > 0 && <div className="bar bar-over" style={{ width: pct(over) }} />}
            </div>
            <div className="strip-end" role="cell">
              <b>{fmt(l.etaMin)}</b> min
              {!readOnly && onWhatIf && (
                <button className={`ghost small ${activeExclude?.includes(l.resourceId) ? 'on' : ''}`} onClick={() => onWhatIf(l)} aria-label={`What if ${l.label} becomes unavailable`}>
                  What if it fails?
                </button>
              )}
            </div>
          </div>
        );
      })}
      {plan.missing.map((m) => (
        <div className="strip-row missing" key={m}>
          <div className="strip-label">
            <strong>{KIND[m].name}</strong>
            <span>None available anywhere in the network</span>
          </div>
          <div className="strip-track" />
          <div className="strip-end">missing</div>
        </div>
      ))}
    </div>
  );
}

/* Small schematic map of the network for the selected plan. */
export function RouteMap({ facilities, plan, origin }) {
  const box = { minLat: 12.83, maxLat: 13.07, minLng: 77.52, maxLng: 77.77 };
  const W = 360, H = 300, pad = 14;
  const x = (lng) => pad + ((lng - box.minLng) / (box.maxLng - box.minLng)) * (W - pad * 2);
  const y = (lat) => pad + (1 - (lat - box.minLat) / (box.maxLat - box.minLat)) * (H - pad * 2);
  const byId = useMemo(() => Object.fromEntries(facilities.map((f) => [f.id, f])), [facilities]);
  const target = byId[plan.targetFacilityId];
  const used = new Set(plan.legs.flatMap((l) => [l.facilityId, l.toFacilityId]));
  const amb = plan.legs.find((l) => l.kind === 'AMBULANCE');
  return (
    <svg className="map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Route map for ${plan.name}`}>
      <rect x="0" y="0" width={W} height={H} rx="8" className="map-bg" />
      {plan.legs
        .filter((l) => l.facilityId !== l.toFacilityId && l.kind !== 'AMBULANCE')
        .map((l) => (
          <line key={l.resourceId} className={`route route-${l.kind}`} x1={x(byId[l.facilityId].lng)} y1={y(byId[l.facilityId].lat)} x2={x(target.lng)} y2={y(target.lat)} />
        ))}
      {amb && (
        <>
          <line className="route route-patient" x1={x(origin.lng)} y1={y(origin.lat)} x2={x(target.lng)} y2={y(target.lat)} />
          <line className="route route-amb" x1={x(byId[amb.facilityId].lng)} y1={y(byId[amb.facilityId].lat)} x2={x(origin.lng)} y2={y(origin.lat)} />
        </>
      )}
      {facilities.map((f) => (
        <g key={f.id}>
          <circle cx={x(f.lng)} cy={y(f.lat)} r={used.has(f.id) ? 4 : 2.5} className={used.has(f.id) ? 'node used' : 'node'} />
          {used.has(f.id) && (
            <text x={x(f.lng) > W - 90 ? x(f.lng) - 7 : x(f.lng) + 7} y={y(f.lat) + 3} textAnchor={x(f.lng) > W - 90 ? 'end' : 'start'} className="node-label">
              {f.name.split(' ').slice(0, 2).join(' ')}
            </text>
          )}
        </g>
      ))}
      <circle cx={x(origin.lng)} cy={y(origin.lat)} r="6" className="origin" />
      <circle cx={x(target.lng)} cy={y(target.lat)} r="7" className="target" />
      <g className="legend" transform={`translate(10 ${H - 34})`}>
        <circle cx="4" cy="4" r="4" className="origin" /><text x="12" y="8">Patient</text>
        <circle cx="70" cy="4" r="5" className="target" /><text x="80" y="8">Treatment site</text>
        <line x1="170" y1="4" x2="190" y2="4" className="route route-patient" /><text x="195" y="8">Patient transport</text>
        <line x1="4" y1="20" x2="24" y2="20" className="route route-BLOOD" /><text x="29" y="24">Blood, staff, equipment moving in</text>
      </g>
    </svg>
  );
}

export function Warnings({ plan }) {
  if (!plan.warnings?.length) return null;
  return (
    <div className="banner warn" role="note">
      <b>Confirm by phone before relying on this plan.</b>
      <ul>
        {plan.warnings.map((w) => (
          <li key={w.facilityId}>{w.name}: data feed last synced {w.ageMin} min ago. Call {w.phone}. Three minutes were added to its steps.</li>
        ))}
      </ul>
    </div>
  );
}

export function WhatIfPanel({ result, onCommit, onClose, readOnly }) {
  if (!result) return null;
  const { excluded, comparison, plans, baseline } = result;
  const best = plans[0];
  return (
    <section className="whatif" aria-live="polite">
      <header>
        <h4>What if {excluded.map((e) => `${e.label} (${e.facility})`).join(', ')} fails?</h4>
        <button className="ghost small" onClick={onClose}>Close</button>
      </header>
      {best ? (
        <>
          <p className="whatif-line">
            Best plan becomes <b>{best.name}</b> at {best.targetName}: <b>{fmt(best.responseMin)} min</b>
            {comparison?.deltaMin != null && (
              <span className={comparison.deltaMin > 0 ? 'delta bad' : 'delta good'}>
                {comparison.deltaMin === 0 ? 'no delay' : `${comparison.deltaMin > 0 ? '+' : ''}${fmt(comparison.deltaMin)} min`}
              </span>
            )}
            <span className={`pill ${best.feasible ? 'ok' : best.status === 'INCOMPLETE' ? 'warn' : 'bad'}`}>{best.feasible ? 'Feasible' : best.status === 'INCOMPLETE' ? 'Incomplete' : 'Over limit'}</span>
          </p>
          {comparison?.changes?.length > 0 && (
            <ul className="changes">
              {comparison.changes.map((c, i) => (
                <li key={i}>
                  <b>{KIND[c.kind].name}</b>: {c.from ?? 'none'} <span aria-hidden>→</span> {c.to ?? 'no replacement'}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="whatif-line bad">No plan can be built without it.</p>
      )}
      <p className="hint">This is a simulation. Nothing changes until the resource is marked offline.</p>
      {!readOnly && (
        <button className="secondary" onClick={onCommit}>
          Mark {excluded.length === 1 ? excluded[0].label : 'these'} offline now
        </button>
      )}
    </section>
  );
}

const STAGE = {
  RESERVED: 'Reserved',
  PREPARING: 'Preparing on site',
  IN_TRANSIT: 'On the way',
  READY: 'Ready',
  EN_ROUTE_TO_PATIENT: 'Heading to patient',
  LOADING_PATIENT: 'Loading patient',
  TRANSPORTING: 'Transporting patient',
  ARRIVED: 'Arrived',
};

export function TrackingBoard({ em, onFail, canAct, facilityName }) {
  const t = em.tracking;
  if (!t) return null;
  const plan = em.approvedPlan;
  return (
    <section className="tracking" aria-live="polite">
      <header className="tracking-head">
        <div>
          <h3>{t.done ? 'Response is in place' : 'Response in progress'}</h3>
          <p>
            {plan.name} at <b>{plan.targetName}</b>. Demo clock: 1 second = 1 minute.
          </p>
        </div>
        <div className={`clock ${t.done ? 'done' : ''}`}>
          <b>{Math.min(Math.round(t.elapsedMin), 99)}</b>
          <span>of {t.responseMin} min</span>
        </div>
      </header>
      <ul className="tasks">
        {t.tasks.map((k) => {
          const progress = Math.min(1, t.elapsedMin / k.etaMin);
          const done = ['READY', 'ARRIVED'].includes(k.stage);
          const leg = plan.legs.find((l) => l.resourceId === k.resourceId);
          return (
            <li key={k.resourceId} className={done ? 'done' : ''}>
              <div className="task-main">
                <strong>{k.label}</strong>
                <span>
                  {facilityName(leg.facilityId)}
                  {leg.facilityId !== leg.toFacilityId ? ` to ${facilityName(leg.toFacilityId)}` : ''}
                </span>
              </div>
              <div className="task-bar" aria-hidden>
                <i style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="task-stage">
                <b>{STAGE[k.stage]}</b>
                <span>{done ? 'done' : `${k.remainingMin} min left`}</span>
              </div>
              {canAct && (
                <button className="ghost small danger" onClick={() => onFail(k)} aria-label={`Simulate ${k.label} failing`}>
                  Simulate failure
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function NewEmergency({ facilities, onCreate, busy }) {
  const presets = [
    { label: 'Road accident', origin: 'F04', text: 'Critical trauma after a road accident, heavy bleeding, needs blood, ICU, ventilator, ambulance and a trauma specialist within 30 minutes' },
    { label: 'Cardiac arrest', origin: 'F13', text: 'Cardiac arrest, unstable patient, needs ICU bed, ventilator and cardiac specialist within 40 minutes' },
    { label: 'Stroke', origin: 'F14', text: 'Serious stroke with head injury, urgent neuro care and ICU bed within 60 minutes' },
  ];
  const [text, setText] = useState(presets[0].text);
  const [origin, setOrigin] = useState(presets[0].origin);
  const submit = (e) => {
    e.preventDefault();
    onCreate({ text, originFacilityId: origin });
  };
  return (
    <form className="new-em" onSubmit={submit}>
      <h3>New emergency</h3>
      <div className="presets" role="group" aria-label="Example emergencies">
        {presets.map((p) => (
          <button type="button" key={p.label} className="ghost small" onClick={() => { setText(p.text); setOrigin(p.origin); }}>
            {p.label}
          </button>
        ))}
      </div>
      <label>
        What is happening?
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Describe the patient and what they need" />
      </label>
      <label>
        Where is the patient now?
        <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>
      <button className="primary" disabled={busy || text.trim().length < 3}>
        {busy ? 'Searching the network…' : 'Find response plans'}
      </button>
    </form>
  );
}
