// Deterministic response planner. The LLM never decides which resources are used;
// this code does, so every plan is reproducible and explainable.
import { travelMin } from './geo.js';
import { donorRank } from './blood.js';

export const TIMING = {
  ambulanceDispatch: 2, // crew mobilisation
  patientLoad: 3, // stabilise + load patient at origin
  bloodPrep: 5, // issue + cross-check + pack
  specialistMobilise: 4,
  ventilatorPrep: 6, // decontaminate, pack, hand over
  onSiteReady: 2, // resource already in the target hospital
  verify: 3, // phone confirmation when a facility's data feed is stale
};
export const STALE_MIN = 15;

export const isAvailable = (r) => (r.type === 'BLOOD' ? r.available > 0 : r.status === 'AVAILABLE');

const fnv = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
};

export function neededKinds(needs) {
  const kinds = [];
  if (needs.icu) kinds.push('ICU_BED');
  if (needs.ventilator) kinds.push('VENTILATOR');
  if (needs.blood) kinds.push('BLOOD');
  if (needs.ambulance) kinds.push('AMBULANCE');
  if (needs.specialist) kinds.push('SPECIALIST');
  return kinds;
}

const best = (arr, key) => arr.reduce((m, x) => (m == null || key(x) < key(m) ? x : m), null);

export function generatePlans(state, emergency, { exclude = [] } = {}) {
  const { needs, timeLimitMin } = emergency.requirements;
  const skip = new Set(exclude);
  const fac = new Map(state.facilities.map((f) => [f.id, f]));
  const origin = fac.get(emergency.originFacilityId);
  const pool = state.resources.filter((r) => isAvailable(r) && !skip.has(r.id));
  const byType = (t) => pool.filter((r) => r.type === t);
  const kinds = neededKinds(needs);

  const beds = byType('ICU_BED');
  const vents = byType('VENTILATOR');
  const ambs = byType('AMBULANCE');
  const specs = needs.specialist ? byType('SPECIALIST').filter((r) => r.attrs.specialty === needs.specialist) : [];
  const bloods = needs.blood
    ? byType('BLOOD').filter((r) => r.available >= needs.blood.units && donorRank(needs.blood.group, r.attrs.group) >= 0)
    : [];

  const targets = state.facilities.filter((f) => (needs.icu ? beds.some((b) => b.facilityId === f.id) : true));
  const plans = [];

  for (const H of targets) {
    const legs = [];
    const missing = [];
    const finish = (l) => {
      const m = state.meta?.[l.facilityId];
      const age = m ? (Date.now() - m.lastSyncAt) / 60000 : 0;
      if (age > STALE_MIN) {
        l.etaMin += TIMING.verify;
        l.stale = true;
        l.syncAgeMin = Math.round(age);
        l.note = `${l.note}. Data ${Math.round(age)} min old, verify by phone`;
      }
      return l;
    };
    const push = (l) => legs.push(finish(l));
    const F = (id) => fac.get(id);

    if (needs.icu) {
      const bed = beds.find((b) => b.facilityId === H.id);
      push({ kind: 'ICU_BED', resourceId: bed.id, label: bed.label, facilityId: H.id, toFacilityId: H.id, etaMin: TIMING.onSiteReady, note: 'On site, held for arrival' });
    }

    if (needs.ventilator) {
      const own = vents.find((v) => v.facilityId === H.id);
      if (own) {
        push({ kind: 'VENTILATOR', resourceId: own.id, label: own.label, facilityId: H.id, toFacilityId: H.id, etaMin: TIMING.onSiteReady, note: 'On site' });
      } else {
        const v = best(vents, (x) => travelMin(F(x.facilityId), H));
        if (v) push({ kind: 'VENTILATOR', resourceId: v.id, label: v.label, facilityId: v.facilityId, toFacilityId: H.id, etaMin: TIMING.ventilatorPrep + travelMin(F(v.facilityId), H), note: 'Transferred from another facility' });
        else missing.push('VENTILATOR');
      }
    }

    if (needs.blood) {
      const eta = (b) => (b.facilityId === H.id ? TIMING.bloodPrep : TIMING.bloodPrep + travelMin(F(b.facilityId), H));
      const b = best(bloods, (x) => eta(x) + donorRank(needs.blood.group, x.attrs.group) * 0.01);
      if (b) {
        const exact = donorRank(needs.blood.group, b.attrs.group) === 0;
        push({
          kind: 'BLOOD', resourceId: b.id, label: `${b.attrs.group} red cells x${needs.blood.units}`, facilityId: b.facilityId, toFacilityId: H.id,
          etaMin: eta(b), units: needs.blood.units, group: b.attrs.group, note: exact ? 'Exact group match' : `Compatible substitute (${b.attrs.group})`,
        });
      } else missing.push('BLOOD');
    }

    if (needs.specialist) {
      const eta = (s) => (s.facilityId === H.id ? TIMING.onSiteReady : TIMING.specialistMobilise + travelMin(F(s.facilityId), H));
      const s = best(specs, eta);
      if (s) push({ kind: 'SPECIALIST', resourceId: s.id, label: `${s.attrs.specialty[0].toUpperCase()}${s.attrs.specialty.slice(1)} specialist`, facilityId: s.facilityId, toFacilityId: H.id, etaMin: eta(s), note: s.facilityId === H.id ? 'On site' : 'Travels to target hospital' });
      else missing.push('SPECIALIST');
    }

    if (needs.ambulance) {
      const total = (a) => TIMING.ambulanceDispatch + travelMin(F(a.facilityId), origin) + TIMING.patientLoad + travelMin(origin, H);
      const a = best(ambs, total);
      if (a) {
        push({
          kind: 'AMBULANCE', resourceId: a.id, label: a.label, facilityId: a.facilityId, fromFacilityId: emergency.originFacilityId, toFacilityId: H.id,
          etaMin: total(a), pickupMin: TIMING.ambulanceDispatch + travelMin(F(a.facilityId), origin),
          note: `${origin.name} to ${H.name}`,
        });
      } else missing.push('AMBULANCE');
    }

    const foundCount = legs.length;
    const critical = legs.reduce((m, l) => (m == null || l.etaMin > m.etaMin ? l : m), null);
    const responseMin = critical ? Math.ceil(critical.etaMin) : null;
    const complete = missing.length === 0;
    const overTime = responseMin != null && responseMin > timeLimitMin;
    const feasible = complete && !overTime;
    const status = feasible ? 'FEASIBLE' : !complete ? 'INCOMPLETE' : 'OVER_TIME';
    const warnings = [...new Map(legs.filter((l) => l.stale).map((l) => [l.facilityId, { facilityId: l.facilityId, name: fac.get(l.facilityId).name, phone: state.meta[l.facilityId].phone, ageMin: l.syncAgeMin }])).values()];
    const roundedLegs = legs.map((l) => ({ ...l, etaMin: Math.round(l.etaMin * 10) / 10 }));

    plans.push({
      id: `PLN-${fnv(H.id + roundedLegs.map((l) => l.resourceId).join('|'))}`,
      targetFacilityId: H.id,
      targetName: H.name,
      legs: roundedLegs,
      missing,
      warnings,
      foundCount,
      totalNeeded: kinds.length,
      responseMin,
      timeLimitMin,
      feasible,
      status,
      criticalKind: critical?.kind ?? null,
      usesUniversalDonorBlood: roundedLegs.some((l) => l.kind === 'BLOOD' && l.group === 'O-'),
    });
  }

  plans.sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.foundCount - a.foundCount || (a.responseMin ?? 1e9) - (b.responseMin ?? 1e9));
  const top = plans.slice(0, 4).map((p, i) => ({ ...p, rank: i, name: `Plan ${'ABCD'[i]}` }));
  top.forEach((p, i) => (p.explanation = explain(p, top[i - 1] ?? null, top[0])));
  return { plans: top, candidatesEvaluated: plans.length, poolSize: pool.length, feasibleCount: plans.filter((p) => p.feasible).length };
}

const KIND_NAME = { ICU_BED: 'ICU bed', VENTILATOR: 'ventilator', BLOOD: 'blood', AMBULANCE: 'ambulance', SPECIALIST: 'specialist' };

function explain(p, prev, first) {
  const parts = [];
  if (p.missing.length) {
    parts.push(`${p.name} at ${p.targetName} cannot be completed: no available ${p.missing.map((m) => KIND_NAME[m]).join(', ')} was found.`);
  } else {
    const verdict = p.feasible ? `meets the ${p.timeLimitMin}-minute limit` : `misses the ${p.timeLimitMin}-minute limit`;
    parts.push(`${p.name} treats the patient at ${p.targetName} in about ${p.responseMin} min and ${verdict}.`);
  }
  if (p.criticalKind) parts.push(`The slowest step is the ${KIND_NAME[p.criticalKind]}.`);
  const ext = p.legs.filter((l) => l.facilityId !== l.toFacilityId && l.kind !== 'AMBULANCE').map((l) => KIND_NAME[l.kind]);
  if (ext.length) parts.push(`Brought in from other facilities: ${ext.join(', ')}.`);
  else if (!p.missing.length) parts.push('Everything except the ambulance is already on site.');
  const blood = p.legs.find((l) => l.kind === 'BLOOD');
  if (p.warnings.length) parts.push(`Confirm by phone: ${p.warnings.map((w) => `${w.name} (data ${w.ageMin} min old)`).join(', ')}.`);
  if (blood && !blood.note.startsWith('Exact')) parts.push(`Blood is a compatible substitute (${blood.group}).`);
  if (prev && p.responseMin != null && first.responseMin != null && p.feasible)
    parts.push(`${p.responseMin - first.responseMin} min slower than ${first.name}.`);
  return parts.join(' ');
}

export function diffLegs(before, after) {
  const b = new Map(before.legs.map((l) => [l.kind, l]));
  const changes = [];
  for (const l of after.legs) {
    const old = b.get(l.kind);
    if (!old || old.resourceId !== l.resourceId) changes.push({ kind: l.kind, from: old?.label ?? null, to: l.label });
  }
  for (const m of after.missing) changes.push({ kind: m, from: b.get(m)?.label ?? null, to: null });
  return changes;
}
