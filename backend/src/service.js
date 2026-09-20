import { extractRequirements } from './engine/requirements.js';
import { generatePlans, diffLegs, isAvailable, STALE_MIN } from './engine/planner.js';
import { authorize, POLICIES } from './authz.js';
import { BLOOD_GROUPS } from './data/seed.js';

const SIM_MIN_PER_SEC = Number(process.env.SIM_MIN_PER_SEC || 1); // demo clock: 1 real second = 1 simulated minute
const SYSTEM = { id: 'system', name: 'AegisGrid dispatch (auto)', role: 'dispatch_lead', kind: 'user', facility: 'NETWORK' };

const RESERVE_EVENT = { ICU_BED: 'BED_RESERVED', VENTILATOR: 'VENTILATOR_RESERVED', BLOOD: 'BLOOD_RESERVED', AMBULANCE: 'AMBULANCE_DISPATCHED', SPECIALIST: 'SPECIALIST_NOTIFIED' };
const RELEASE_EVENT = { ICU_BED: 'BED_AVAILABLE', VENTILATOR: 'VENTILATOR_AVAILABLE', BLOOD: 'BLOOD_ADDED', AMBULANCE: 'AMBULANCE_AVAILABLE', SPECIALIST: 'SPECIALIST_AVAILABLE' };
const OFFLINE_EVENT = { ICU_BED: 'BED_UNAVAILABLE', VENTILATOR: 'VENTILATOR_UNAVAILABLE', BLOOD: 'BLOOD_UNAVAILABLE', AMBULANCE: 'AMBULANCE_UNAVAILABLE', SPECIALIST: 'SPECIALIST_UNAVAILABLE' };

export function createService(state) {
  const fac = (id) => state.facilities.find((f) => f.id === id);
  const res = (id) => state.resources.find((r) => r.id === id);
  const actorOf = (op) => ({ id: op.id, name: op.name, role: op.role });

  const emit = (type, detail = {}) => {
    const e = { id: `EVT-${state.events.length + 1}`, ts: new Date().toISOString(), type, ...detail };
    state.events.push(e);
    return e;
  };
  // SNS stand-in: one message per facility topic.
  const notify = (facilityId, message, emergencyId) =>
    state.outbox.push({ id: `MSG-${state.outbox.length + 1}`, ts: new Date().toISOString(), channel: 'SNS', topic: `facility-${facilityId}`, facilityId, facilityName: fac(facilityId)?.name, emergencyId, message });

  function check(op, action, resource, { logAllow = false } = {}) {
    const d = authorize({ principal: op, action, resource });
    if (!d.allowed || logAllow) {
      emit(d.allowed ? 'POLICY_ALLOW' : 'POLICY_DENY', {
        actor: actorOf(op), emergencyId: resource.emergencyId, matched: d.matched,
        text: `${op.name} ${d.allowed ? 'was allowed to' : 'was blocked from'} ${action}. ${d.reasons[0]}`,
      });
    }
    return d;
  }
  const denied = (d, what) => ({ status: 403, error: `Cedar policy blocked ${what}.`, reasons: d.reasons });

  const plansFor = (em, exclude = []) => generatePlans(state, em, { exclude });

  // ---------- emergencies ----------
  async function createEmergency({ text, originFacilityId, timeLimitMin }, op, { skipPolicy = false } = {}) {
    if (!skipPolicy) {
      const d = check(op, 'CreateEmergency', { type: 'Network', id: 'network' });
      if (!d.allowed) return denied(d, 'opening an emergency');
    }
    if (!text || text.trim().length < 3) return { error: 'Describe the emergency in a sentence.', status: 400 };
    if (!fac(originFacilityId)) return { error: 'Choose where the patient is now.', status: 400 };
    const requirements = await extractRequirements(text);
    if (Number.isFinite(timeLimitMin) && timeLimitMin > 0) requirements.timeLimitMin = Math.round(timeLimitMin);
    const em = { id: `EMG-${++state.seq}`, createdAt: Date.now(), createdBy: actorOf(op), text: text.trim(), originFacilityId, requirements, status: 'PLANNED', approvedPlan: null, approvedAt: null, approvedBy: null, alert: null, reservations: [], acks: {}, timeline: [] };
    state.emergencies.set(em.id, em);
    emit('EMERGENCY_CREATED', { actor: actorOf(op), emergencyId: em.id, text: `${op.name} opened ${em.id}: ${requirements.patient.condition} (${requirements.patient.severity}).` });
    em.timeline.push({ ts: Date.now(), text: `Opened by ${op.name}. Requirements extracted by ${requirements.source === 'bedrock' ? 'Amazon Bedrock' : 'rules'}.` });
    return { status: 201, emergency: view(em) };
  }

  function tracking(em) {
    if (!em.approvedPlan || em.status !== 'RESERVED') return null;
    const elapsed = ((Date.now() - em.approvedAt) / 1000) * SIM_MIN_PER_SEC;
    const tasks = em.approvedPlan.legs.map((l) => {
      let stage;
      if (l.kind === 'AMBULANCE') {
        stage = elapsed < 0.3 ? 'RESERVED' : elapsed < l.pickupMin ? 'EN_ROUTE_TO_PATIENT' : elapsed < l.pickupMin + 3 ? 'LOADING_PATIENT' : elapsed < l.etaMin ? 'TRANSPORTING' : 'ARRIVED';
      } else {
        stage = elapsed < 0.3 ? 'RESERVED' : elapsed < l.etaMin ? (l.facilityId === l.toFacilityId ? 'PREPARING' : 'IN_TRANSIT') : 'READY';
      }
      return { resourceId: l.resourceId, kind: l.kind, label: l.label, stage, etaMin: l.etaMin, remainingMin: Math.max(0, Math.round((l.etaMin - elapsed) * 10) / 10) };
    });
    const done = tasks.every((t) => ['READY', 'ARRIVED'].includes(t.stage));
    return { elapsedMin: Math.round(elapsed * 10) / 10, responseMin: em.approvedPlan.responseMin, done, tasks };
  }

  function view(em) {
    const planning = em.status === 'PLANNED' ? plansFor(em) : null;
    return {
      id: em.id, createdAt: em.createdAt, createdBy: em.createdBy, text: em.text, origin: fac(em.originFacilityId),
      requirements: em.requirements, status: em.status, alert: em.alert, planning,
      approvedPlan: em.approvedPlan, approvedBy: em.approvedBy, approvedAt: em.approvedAt,
      acks: Object.entries(em.acks).map(([facilityId, a]) => ({ facilityId, name: fac(facilityId)?.name, ...a })),
      tracking: tracking(em), timeline: em.timeline,
    };
  }

  function whatIf(em, excludeIds) {
    const base = plansFor(em);
    const alt = plansFor(em, excludeIds);
    const b = base.plans[0];
    const a = alt.plans[0];
    return {
      excluded: excludeIds.map((id) => ({ id, label: res(id)?.label ?? id, facility: fac(res(id)?.facilityId)?.name })),
      baseline: b ?? null,
      plans: alt.plans,
      stats: { candidatesEvaluated: alt.candidatesEvaluated, feasibleCount: alt.feasibleCount },
      comparison: b && a ? { deltaMin: a.responseMin != null && b.responseMin != null ? a.responseMin - b.responseMin : null, changes: diffLegs(b, a), stillFeasible: a.feasible } : null,
    };
  }

  // ---------- reservation ----------
  function reserve(em, plan, actor) {
    for (const l of plan.legs) {
      const r = res(l.resourceId);
      if (!r || !isAvailable(r)) return { ok: false, resource: l.label };
      if (r.type === 'BLOOD' && r.available < l.units) return { ok: false, resource: l.label };
    }
    for (const l of plan.legs) {
      const r = res(l.resourceId);
      if (r.type === 'BLOOD') {
        r.available -= l.units;
        em.reservations.push({ resourceId: r.id, units: l.units });
      } else {
        r.status = 'RESERVED';
        r.reservedFor = em.id;
        em.reservations.push({ resourceId: r.id, units: 1 });
      }
      r.updatedAt = new Date().toISOString();
      emit(RESERVE_EVENT[r.type], { actor, emergencyId: em.id, resourceId: r.id, facilityId: r.facilityId, text: `${r.label} at ${fac(r.facilityId).name} reserved for ${em.id}.` });
    }
    return { ok: true };
  }

  function release(em, why) {
    for (const rv of em.reservations) {
      const r = res(rv.resourceId);
      if (!r) continue;
      if (r.type === 'BLOOD') r.available += rv.units;
      else if (r.status === 'RESERVED' && r.reservedFor === em.id) {
        r.status = 'AVAILABLE';
        delete r.reservedFor;
      }
      r.updatedAt = new Date().toISOString();
      emit(RELEASE_EVENT[r.type], { emergencyId: em.id, resourceId: r.id, facilityId: r.facilityId, text: `${r.label} at ${fac(r.facilityId).name} released (${why}).` });
    }
    const facs = new Set(em.reservations.map((rv) => res(rv.resourceId)?.facilityId).filter(Boolean));
    facs.forEach((f) => notify(f, `${em.id}: reservation released (${why}). Resources are available again.`, em.id));
    em.reservations = [];
    em.acks = {};
  }

  function approve(id, planId, op, { skipPolicy = false, autoAck = false } = {}) {
    const em = state.emergencies.get(id);
    if (!em) return { status: 404, error: 'Emergency not found.' };
    if (em.status !== 'PLANNED') return { status: 409, error: `Emergency is ${em.status.toLowerCase()}; nothing to approve.` };
    const plan = plansFor(em).plans.find((p) => p.id === planId);
    if (!plan) return { status: 409, error: 'Availability changed and that plan no longer exists. Review the updated plans.', emergency: view(em) };

    let decision = { allowed: true, reasons: ['Approved by system seed'], matched: [] };
    if (!skipPolicy) {
      decision = check(op, 'ApprovePlan', { type: 'Plan', id: plan.id, emergencyId: em.id, attrs: { feasible: plan.feasible, responseMin: plan.responseMin ?? 0, timeLimitMin: plan.timeLimitMin, usesUniversalDonorBlood: plan.usesUniversalDonorBlood } }, { logAllow: true });
      if (!decision.allowed) return denied(decision, 'this approval');
    }

    const r = reserve(em, plan, actorOf(op));
    if (!r.ok) return { status: 409, error: `${r.resource} was taken just now. Plans have been recalculated.`, emergency: view(em) };

    em.status = 'RESERVED';
    em.approvedPlan = plan;
    em.approvedAt = Date.now();
    em.approvedBy = { id: op.id, name: op.name, role: op.role };
    em.alert = null;
    em.timeline.push({ ts: Date.now(), text: `${plan.name} approved by ${op.name}. Resources reserved. Waiting for facility confirmations.` });
    const facs = new Set(plan.legs.flatMap((l) => [l.facilityId, l.toFacilityId]));
    facs.forEach((f) => {
      const provide = plan.legs.filter((l) => l.facilityId === f).map((l) => l.label);
      const receive = plan.legs.filter((l) => l.toFacilityId === f && l.facilityId !== f).map((l) => l.label);
      const bits = [provide.length ? `provide ${provide.join(', ')}` : '', receive.length ? `receive ${receive.join(', ')}` : ''].filter(Boolean);
      em.acks[f] = { status: autoAck ? 'ACCEPTED' : 'PENDING', provide, receive, summary: bits.join('; '), since: Date.now(), by: autoAck ? 'auto' : null };
      notify(f, `${em.id} (${em.requirements.patient.condition}): please ${bits.join(' and ')}. Treatment site: ${plan.targetName}. Expected within ${plan.responseMin} min. Please confirm.`, em.id);
    });
    return { status: 200, emergency: view(em), policy: decision };
  }

  // A facility confirms it can honour its part, or declines. Declining voids the approval and replans.
  function acknowledge(id, facilityId, decision, op) {
    const em = state.emergencies.get(id);
    if (!em || em.status !== 'RESERVED' || !em.acks[facilityId]) return { status: 409, error: 'There is no open request for that facility.' };
    const d = check(op, 'AcknowledgeRequest', { type: 'Facility', id: facilityId, emergencyId: em.id, attrs: { facility: facilityId } });
    if (!d.allowed) return denied(d, 'this response');
    if (decision === 'ACCEPT') {
      em.acks[facilityId] = { ...em.acks[facilityId], status: 'ACCEPTED', by: op.name, at: Date.now() };
      em.timeline.push({ ts: Date.now(), text: `${fac(facilityId).name} confirmed (${op.name}).` });
      emit('FACILITY_CONFIRMED', { actor: actorOf(op), emergencyId: em.id, facilityId, text: `${fac(facilityId).name} confirmed its part of ${em.id}.` });
      return { status: 200, emergency: view(em) };
    }
    if (decision !== 'DECLINE') return { status: 400, error: 'Decision must be ACCEPT or DECLINE.' };
    const legs = em.approvedPlan.legs.filter((l) => l.facilityId === facilityId);
    emit('FACILITY_DECLINED', { actor: actorOf(op), emergencyId: em.id, facilityId, text: `${fac(facilityId).name} declined its part of ${em.id}.` });
    for (const l of legs) setStatusInternal(l.resourceId, 'UNAVAILABLE', actorOf(op), `${fac(facilityId).name} declined`);
    return { status: 200, emergency: view(em) };
  }

  function cancel(id, op, reason = 'cancelled by operator') {
    const em = state.emergencies.get(id);
    if (!em) return { status: 404, error: 'Emergency not found.' };
    const d = check(op, 'CancelEmergency', { type: 'Emergency', id: em.id, emergencyId: em.id, attrs: { severity: em.requirements.patient.severity } }, { logAllow: true });
    if (!d.allowed) return denied(d, 'this cancellation');
    release(em, reason);
    em.status = 'CANCELLED';
    em.timeline.push({ ts: Date.now(), text: `Cancelled by ${op.name}. Resources released.` });
    return { status: 200, emergency: view(em) };
  }

  // ---------- resource state ----------
  function setStatusInternal(id, status, actor, reason) {
    const r = res(id);
    let replanned = null;
    if (status === 'UNAVAILABLE') {
      const em = [...state.emergencies.values()].find((e) => e.status === 'RESERVED' && e.reservations.some((rv) => rv.resourceId === id));
      if (em) {
        release(em, reason ?? `${r.label} went offline`);
        em.status = 'PLANNED';
        em.approvedPlan = null;
        em.alert = { message: `${reason ?? `${r.label} at ${fac(r.facilityId).name} went offline`}. The approval was voided and every reservation released. Review the new plans.`, at: Date.now() };
        em.timeline.push({ ts: Date.now(), text: em.alert.message });
        replanned = em.id;
      }
      if (r.type === 'BLOOD') r.available = 0;
      r.status = 'UNAVAILABLE';
    } else {
      r.status = 'AVAILABLE';
      if (r.type === 'BLOOD') r.available = r.quantity;
    }
    r.updatedAt = new Date().toISOString();
    emit(status === 'UNAVAILABLE' ? OFFLINE_EVENT[r.type] : RELEASE_EVENT[r.type], {
      actor, resourceId: id, facilityId: r.facilityId, emergencyId: replanned ?? undefined,
      text: status === 'UNAVAILABLE' ? `${r.label} at ${fac(r.facilityId).name} marked unavailable${replanned ? `; ${replanned} sent back for replanning` : ''}.` : `${r.label} at ${fac(r.facilityId).name} is available again.`,
    });
    return { status: 200, resource: r, replannedEmergency: replanned };
  }

  function setResourceStatus(id, status, op) {
    const r = res(id);
    if (!r) return { status: 404, error: 'Resource not found.' };
    if (!['AVAILABLE', 'UNAVAILABLE'].includes(status)) return { status: 400, error: 'Status must be AVAILABLE or UNAVAILABLE.' };
    const d = check(op, 'SetResourceStatus', { type: 'Resource', id: r.id, attrs: { facility: r.facilityId } });
    if (!d.allowed) return denied(d, 'this change');
    return setStatusInternal(id, status, actorOf(op));
  }

  // ---------- facility inventory (the real-time data entry point) ----------
  function setAvailableCount(fid, type, n) {
    const rs = state.resources.filter((r) => r.facilityId === fid && r.type === type && !['RESERVED', 'UNAVAILABLE'].includes(r.status));
    const avail = rs.filter((r) => r.status === 'AVAILABLE');
    const busy = rs.filter((r) => r.status === 'IN_USE');
    const target = Math.max(0, Math.min(rs.length, Math.round(Number(n))));
    while (avail.length < target && busy.length) { const r = busy.pop(); r.status = 'AVAILABLE'; r.updatedAt = new Date().toISOString(); avail.push(r); }
    while (avail.length > target) { const r = avail.pop(); r.status = 'IN_USE'; r.updatedAt = new Date().toISOString(); busy.push(r); }
    return target;
  }

  function updateInventory(fid, patch, op, via = 'dashboard') {
    if (!fac(fid)) return { status: 404, error: 'Facility not found.' };
    const d = check(op, 'UpdateInventory', { type: 'Facility', id: fid, attrs: { facility: fid } });
    if (!d.allowed) return denied(d, 'this inventory update');
    const changes = [];
    const num = (v) => Number.isFinite(Number(v)) && Number(v) >= 0;
    for (const [key, type, label] of [['icuBedsAvailable', 'ICU_BED', 'ICU beds'], ['ventilatorsAvailable', 'VENTILATOR', 'ventilators'], ['ambulancesAvailable', 'AMBULANCE', 'ambulances']]) {
      if (patch[key] !== undefined) {
        if (!num(patch[key])) return { status: 400, error: `${label} must be a number of 0 or more.` };
        changes.push(`${label} available: ${setAvailableCount(fid, type, patch[key])}`);
      }
    }
    for (const [g, n] of Object.entries(patch.blood ?? {})) {
      if (!BLOOD_GROUPS.includes(g) || !num(n)) return { status: 400, error: `Blood stock for ${g} must be a number of 0 or more.` };
      const units = Math.min(200, Math.round(Number(n)));
      const id = `BLOOD-${fid}-${g.replace('+', 'pos').replace('-', 'neg')}`;
      let line = res(id);
      if (!line) {
        if (units === 0) continue;
        line = { id, type: 'BLOOD', facilityId: fid, label: `Blood ${g} (red cells)`, status: 'AVAILABLE', quantity: 0, available: 0, attrs: { group: g, component: 'RBC' } };
        state.resources.push(line);
      }
      const reserved = line.quantity - line.available;
      line.available = units;
      line.quantity = units + reserved;
      line.status = units > 0 ? 'AVAILABLE' : 'IN_USE';
      line.updatedAt = new Date().toISOString();
      changes.push(`${g} blood: ${units} units`);
    }
    state.meta[fid].lastSyncAt = Date.now();
    state.meta[fid].connected = true;
    emit('INVENTORY_UPDATED', { actor: actorOf(op), facilityId: fid, text: `${fac(fid).name} updated inventory via ${via}: ${changes.join(', ') || 'no changes'}.` });
    return { status: 200, facility: facilityDetail(fid) };
  }

  function inventoryOf(fid) {
    const rs = state.resources.filter((r) => r.facilityId === fid);
    const count = (t) => {
      const list = rs.filter((r) => r.type === t);
      return { total: list.length, available: list.filter((r) => r.status === 'AVAILABLE').length, reserved: list.filter((r) => r.status === 'RESERVED').length, offline: list.filter((r) => r.status === 'UNAVAILABLE').length };
    };
    const blood = Object.fromEntries(BLOOD_GROUPS.map((g) => [g, rs.find((r) => r.type === 'BLOOD' && r.attrs.group === g)?.available ?? 0]));
    const specialists = rs.filter((r) => r.type === 'SPECIALIST').map((r) => ({ id: r.id, label: r.label, specialty: r.attrs.specialty, status: r.status }));
    return { icu: count('ICU_BED'), ventilators: count('VENTILATOR'), ambulances: count('AMBULANCE'), specialists, blood };
  }

  const syncInfo = (fid) => {
    const m = state.meta[fid];
    const ageMin = Math.max(0, Math.round((Date.now() - m.lastSyncAt) / 60000));
    return { phone: m.phone, connected: m.connected, lastSyncAt: m.lastSyncAt, ageMin, stale: ageMin > STALE_MIN };
  };

  function requestsFor(fid) {
    return [...state.emergencies.values()]
      .filter((e) => e.acks[fid] && e.status === 'RESERVED')
      .map((e) => ({ emergencyId: e.id, condition: e.requirements.patient.condition, severity: e.requirements.patient.severity, targetName: e.approvedPlan.targetName, responseMin: e.approvedPlan.responseMin, ...e.acks[fid] }))
      .reverse();
  }

  function facilityDetail(fid) {
    const f = fac(fid);
    if (!f) return null;
    return { ...f, ...syncInfo(fid), inventory: inventoryOf(fid), requests: requestsFor(fid), activity: state.events.filter((e) => e.facilityId === fid).slice(-12).reverse() };
  }

  function network() {
    return state.facilities.map((f) => {
      const inv = inventoryOf(f.id);
      return { ...f, ...syncInfo(f.id), icuFree: inv.icu.available, icuTotal: inv.icu.total, ventFree: inv.ventilators.available, ambFree: inv.ambulances.available, oNeg: inv.blood['O-'], bloodTotal: Object.values(inv.blood).reduce((a, b) => a + b, 0), pendingRequests: requestsFor(f.id).filter((r) => r.status === 'PENDING').length };
    });
  }

  function heartbeat() {
    for (const m of Object.values(state.meta)) if (m.connected) m.lastSyncAt = Date.now();
  }

  function dashboard() {
    const active = [...state.emergencies.values()].filter((e) => ['PLANNED', 'RESERVED'].includes(e.status));
    const count = (t) => state.resources.filter((r) => r.type === t && r.status === 'AVAILABLE').length;
    return {
      facilities: state.facilities.length,
      staleFacilities: Object.keys(state.meta).filter((id) => syncInfo(id).stale).length,
      activeEmergencies: active.length,
      awaitingApproval: active.filter((e) => e.status === 'PLANNED').length,
      critical: active.filter((e) => e.requirements.patient.severity === 'critical').length,
      icuBeds: count('ICU_BED'), ventilators: count('VENTILATOR'), ambulances: count('AMBULANCE'),
      bloodUnits: state.resources.filter((r) => r.type === 'BLOOD').reduce((s, r) => s + r.available, 0),
      resourcesTracked: state.resources.length,
      availableResources: state.resources.filter(isAvailable).length,
    };
  }

  const audit = (limit = 150) => state.events.filter((e) => e.text).slice(-limit).reverse();

  // Background load so the command centre is not empty and resources are realistically tight.
  async function seedBackground() {
    const jobs = [
      { text: 'Cardiac arrest, unstable, needs ICU and ventilator within 40 minutes', originFacilityId: 'F08', mins: 9 },
      { text: 'Serious stroke, urgent neuro care, 60 minutes', originFacilityId: 'F16', mins: 4 },
    ];
    for (const j of jobs) {
      const r = await createEmergency(j, SYSTEM, { skipPolicy: true });
      const first = r.emergency?.planning?.plans?.find((p) => p.feasible);
      if (first) {
        approve(r.emergency.id, first.id, SYSTEM, { skipPolicy: true, autoAck: true });
        state.emergencies.get(r.emergency.id).approvedAt = Date.now() - (j.mins * 1000) / SIM_MIN_PER_SEC;
      }
    }
  }

  const reset = () => state.reset();

  return { createEmergency, view, whatIf, approve, acknowledge, cancel, setResourceStatus, updateInventory, facilityDetail, network, heartbeat, dashboard, audit, seedBackground, reset, plansFor, check, state, POLICIES };
}
