import React, { useEffect, useState } from 'react';
import { api, ROLE_LABEL, timeAgo } from './api.js';
import { ClockStrip, NeedChips, NewEmergency, RouteMap, TrackingBoard, WhatIfPanel, Warnings, fmt } from './components.jsx';

const statusPill = (s) => (s === 'FEASIBLE' ? ['ok', 'Feasible'] : s === 'INCOMPLETE' ? ['warn', 'Incomplete'] : ['bad', 'Over limit']);
const stateLabel = (e) => (e.status === 'PLANNED' ? 'Awaiting approval' : e.status === 'RESERVED' ? (e.tracking?.done ? 'Response in place' : 'In progress') : 'Cancelled');

export default function CommandCenter({ user, caps, facilities, ems, dash, feed, refresh, flash, selectedId, setSelectedId }) {
  const [planId, setPlanId] = useState(null);
  const [whatif, setWhatif] = useState(null);
  const [denial, setDenial] = useState(null);
  const [busy, setBusy] = useState(false);

  const fname = (id) => facilities.find((f) => f.id === id)?.name ?? id;
  const em = ems.find((e) => e.id === selectedId) ?? null;
  useEffect(() => {
    if (!selectedId && ems.length) setSelectedId(ems[0].id);
  }, [ems, selectedId, setSelectedId]);

  const plans = em?.planning?.plans ?? [];
  const plan = plans.find((p) => p.id === planId) ?? plans[0] ?? null;
  const sev = em?.requirements.patient.severity;
  const mineFacility = user.role === 'facility_admin' ? user.facility : null;
  const needsMe = (e) => mineFacility && e.acks?.some((a) => a.facilityId === mineFacility && a.status === 'PENDING');
  const involvesMe = (e) => mineFacility && e.acks?.some((a) => a.facilityId === mineFacility);
  const awaiting = ems.filter((e) => e.status === 'PLANNED').length;
  const pendingMine = ems.filter(needsMe).length;

  const select = (id) => { setSelectedId(id); setPlanId(null); setWhatif(null); setDenial(null); };

  const create = async (body) => {
    setBusy(true);
    setDenial(null);
    setWhatif(null);
    const r = await api('/emergencies', { method: 'POST', body });
    setBusy(false);
    if (r.ok) { select(r.data.id); refresh(); } else flash(r.data.error || 'Could not open the emergency.');
  };

  const runWhatIf = async (leg) => {
    const r = await api(`/emergencies/${em.id}/whatif`, { method: 'POST', body: { exclude: [leg.resourceId] } });
    if (r.ok) setWhatif({ ...r.data, leg });
  };

  const setResource = async (resourceId, status) => {
    const r = await api(`/resources/${resourceId}/status`, { method: 'POST', body: { status } });
    if (r.status === 403) setDenial({ title: r.data.error, reasons: r.data.reasons, action: 'status' });
    else if (r.ok) {
      setWhatif(null);
      if (r.data.replannedEmergency) flash('A reserved resource went offline. Approval voided and plans recalculated.');
    }
    refresh();
  };

  const approve = async () => {
    setDenial(null);
    const r = await api(`/emergencies/${em.id}/approve`, { method: 'POST', body: { planId: plan.id } });
    if (r.status === 403) setDenial({ title: r.data.error, reasons: r.data.reasons, action: 'approve' });
    else if (!r.ok) flash(r.data.error);
    else { setWhatif(null); flash('Approved. Resources reserved and facilities asked to confirm.'); }
    refresh();
  };

  const cancel = async () => {
    setDenial(null);
    const r = await api(`/emergencies/${em.id}/cancel`, { method: 'POST', body: { reason: 'cancelled by operator' } });
    if (r.status === 403) setDenial({ title: r.data.error, reasons: r.data.reasons, action: 'cancel' });
    else flash('Cancelled. Resources released.');
    refresh();
  };

  const answer = async (facilityId, decision) => {
    const r = await api(`/emergencies/${em.id}/acknowledge`, { method: 'POST', body: { facilityId, decision } });
    if (r.status === 403) setDenial({ title: r.data.error, reasons: r.data.reasons, action: 'ack' });
    else if (!r.ok) flash(r.data.error);
    else flash(decision === 'ACCEPT' ? 'Confirmed.' : 'Declined. The plan was sent back for replanning.');
    refresh();
  };

  const reset = async () => {
    const r = await api('/reset', { method: 'POST' });
    if (r.ok) { setSelectedId(null); setWhatif(null); setDenial(null); flash('Demo network reset.'); }
    else flash(r.data.error);
    refresh();
  };

  const firstName = user.name.replace(/^Dr\. /, '').split(' ')[0];

  return (
    <div className="app">
      <aside className="rail left">
        <p className="hello">Signed in as <b>{user.name}</b></p>
        {dash && (
          <dl className="stats" aria-label="Network status">
            <div className={dash.critical ? 'alarm' : ''}><dt>Active</dt><dd>{dash.activeEmergencies}</dd></div>
            <div className={dash.critical ? 'alarm' : ''}><dt>Critical</dt><dd>{dash.critical}</dd></div>
            <div><dt>ICU beds free</dt><dd>{dash.icuBeds}</dd></div>
            <div><dt>Ventilators free</dt><dd>{dash.ventilators}</dd></div>
            <div><dt>Ambulances free</dt><dd>{dash.ambulances}</dd></div>
            <div><dt>Blood units</dt><dd>{dash.bloodUnits}</dd></div>
          </dl>
        )}
        {dash && <p className="net-note">{dash.facilities} facilities{dash.staleFacilities ? `, ${dash.staleFacilities} with stale data` : ''}</p>}

        <h3 className="rail-title">Your queue</h3>
        <ul className="queue">
          {caps.approve && <li><b>{awaiting}</b> awaiting approval</li>}
          {mineFacility && <li><b>{pendingMine}</b> waiting for your confirmation</li>}
          <li><b>{ems.filter((e) => e.status === 'RESERVED' && !e.tracking?.done).length}</b> in progress</li>
        </ul>

        <h3 className="rail-title">Emergencies</h3>
        <ul className="em-list">
          {ems.length === 0 && <li className="empty">No emergencies yet.</li>}
          {ems.map((e) => (
            <li key={e.id}>
              <button className={`em-item ${e.id === selectedId ? 'sel' : ''}`} onClick={() => select(e.id)}>
                <span className={`dot ${e.requirements.patient.severity}`} aria-hidden />
                <span className="em-text">
                  <b>{e.id}</b> {e.requirements.patient.condition}
                  <small>{stateLabel(e)}{needsMe(e) ? ' · needs your answer' : involvesMe(e) ? ' · involves your facility' : ''}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {caps.create ? <NewEmergency facilities={facilities} onCreate={create} busy={busy} /> : (
          <p className="role-note">{user.role === 'facility_admin' ? 'Facility desks answer requests and keep inventory current under "My facility".' : 'Your role is read-only. Cedar will block changes.'}</p>
        )}
        {caps.reset && <button className="ghost small reset" onClick={reset}>Reset demo data</button>}
      </aside>

      <main className="main">
        {!em && <div className="blank"><h2>Good to see you, {firstName}</h2><p>{caps.create ? 'Describe an emergency on the left. AegisGrid will search every connected facility and build response plans.' : 'Pick an emergency on the left to follow it.'}</p></div>}

        {em && (
          <>
            <header className="em-head">
              <div>
                <div className="em-id">{em.id} <span className={`pill sev-${sev}`}>{sev}</span> <span className="pill neutral">{stateLabel(em)}</span></div>
                <h2>{em.requirements.patient.condition}</h2>
                <p className="em-desc">{em.text}</p>
                <p className="em-meta">Patient at <b>{em.origin.name}</b>. Must be treated within <b>{em.requirements.timeLimitMin} min</b>. Opened by {em.createdBy?.name}. Requirements read by {em.requirements.source === 'bedrock' ? 'Amazon Bedrock' : 'the rule-based parser'}.</p>
              </div>
              <NeedChips needs={em.requirements.needs} />
            </header>

            {em.alert && <div className="banner bad" role="alert"><b>Replan needed.</b> {em.alert.message}</div>}

            {em.status === 'PLANNED' && em.planning && (
              <>
                <p className="search-line">
                  Searched {dash?.facilities ?? 17} facilities and {em.planning.poolSize} available resources. Evaluated {em.planning.candidatesEvaluated} treatment sites. {em.planning.feasibleCount} can meet the {em.requirements.timeLimitMin}-minute limit.
                </p>
                <div className="plan-tabs" role="tablist" aria-label="Response plans">
                  {plans.map((p) => {
                    const [cls, label] = statusPill(p.status);
                    return (
                      <button key={p.id} role="tab" aria-selected={plan?.id === p.id} className={`plan-tab ${plan?.id === p.id ? 'sel' : ''}`} onClick={() => { setPlanId(p.id); setWhatif(null); }}>
                        <span className="pt-name">{p.name}</span>
                        <span className="pt-time">{fmt(p.responseMin)}<small> min</small></span>
                        <span className={`pill ${cls}`}>{label}</span>
                        <span className="pt-res">{p.foundCount}/{p.totalNeeded} resources{p.warnings?.length ? ' · verify' : ''}</span>
                      </button>
                    );
                  })}
                  {plans.length === 0 && <p className="empty">No facility has an ICU bed free right now.</p>}
                </div>

                {plan && (
                  <section className="plan" aria-label={plan.name}>
                    <h3>{plan.name}: treat at {plan.targetName}</h3>
                    <p className="explain">{plan.explanation}</p>
                    <ClockStrip plan={plan} onWhatIf={runWhatIf} activeExclude={whatif?.excluded.map((e) => e.id)} readOnly={!caps.setStatus && !caps.create} />
                    <Warnings plan={plan} />
                    <div className="plan-lower">
                      <div>
                        {whatif ? (
                          <WhatIfPanel result={whatif} onClose={() => setWhatif(null)} onCommit={() => setResource(whatif.leg.resourceId, 'UNAVAILABLE')} readOnly={!caps.setStatus} />
                        ) : (
                          <p className="tip">Press <b>What if it fails?</b> on any resource to see how the plan adapts. Simulating changes nothing.</p>
                        )}
                      </div>
                      <RouteMap facilities={facilities} plan={plan} origin={em.origin} />
                    </div>

                    <div className="approve">
                      <div>
                        <b>{caps.approve ? 'Human approval required.' : 'Waiting for an authorised approver.'}</b>
                        <span>{caps.approve ? `You are signed in as ${ROLE_LABEL[user.role]}. Cedar checks the policy before anything is reserved.` : `${ROLE_LABEL[user.role]} accounts cannot approve plans.`}</span>
                      </div>
                      {caps.approve && <button className="primary big" onClick={approve}>{plan.feasible ? `Approve ${plan.name}` : `Try to approve ${plan.name}`}</button>}
                    </div>
                    {!plan.feasible && caps.approve && <p className="hint">{plan.name} is not feasible, so the policy will refuse it.</p>}
                    {denial && (denial.action === 'approve' || denial.action === 'status') && (
                      <div className="denial" role="alert">
                        <b>Blocked by Cedar policy.</b>
                        <ul>{(denial.reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
                        <span>Sign in with an account that has the right role to continue.</span>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}

            {em.status === 'RESERVED' && (
              <>
                <TrackingBoard em={em} facilityName={fname} canAct={caps.setStatus} onFail={(k) => setResource(k.resourceId, 'UNAVAILABLE')} />

                <section className="acks" aria-label="Facility confirmations">
                  <h3>Facility confirmations</h3>
                  <ul>
                    {em.acks.map((a) => (
                      <li key={a.facilityId}>
                        <div>
                          <b>{a.name}</b>
                          <span>{a.summary ? a.summary[0].toUpperCase() + a.summary.slice(1) : ''}</span>
                        </div>
                        <span className={`pill ${a.status === 'ACCEPTED' ? 'ok' : 'warn'}`}>{a.status === 'ACCEPTED' ? `Confirmed${a.by && a.by !== 'auto' ? ` by ${a.by}` : ''}` : 'Waiting'}</span>
                        {a.status === 'PENDING' && caps.acknowledge && user.facility === a.facilityId && (
                          <span className="ack-actions">
                            <button className="secondary small" onClick={() => answer(a.facilityId, 'ACCEPT')}>Confirm</button>
                            <button className="ghost small danger" onClick={() => answer(a.facilityId, 'DECLINE')}>Decline</button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>

                <div className="approve tight">
                  <div>
                    <b>Approved by {em.approvedBy?.name}.</b>
                    <span>{em.approvedPlan.explanation}</span>
                  </div>
                  {caps.cancel && <button className="secondary" onClick={cancel}>Cancel and release resources</button>}
                </div>
                {denial && (denial.action === 'cancel' || denial.action === 'ack' || denial.action === 'status') && (
                  <div className="denial" role="alert"><b>Blocked by Cedar policy.</b><ul>{(denial.reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul></div>
                )}
              </>
            )}

            {em.status === 'CANCELLED' && <div className="banner neutral">This emergency was cancelled. Every reservation was released back to the network.</div>}

            <section className="timeline">
              <h4>Timeline</h4>
              <ol>{[...em.timeline].reverse().map((t, i) => <li key={i}><time>{new Date(t.ts).toLocaleTimeString()}</time> {t.text}</li>)}</ol>
            </section>
          </>
        )}
      </main>

      <aside className="rail right">
        <h3 className="rail-title">{user.role === 'facility_admin' ? 'Messages to your facility' : 'Facility notifications'}</h3>
        <ul className="feed">
          {feed.outbox.length === 0 && <li className="empty">Nothing sent yet. Messages go out after approval.</li>}
          {feed.outbox.slice(0, 8).map((m) => (
            <li key={m.id}><b>{m.facilityName}</b><span>{m.message}</span><time>{timeAgo(m.ts)}</time></li>
          ))}
        </ul>
        <h3 className="rail-title">Recent activity</h3>
        <ul className="feed events">
          {feed.events.filter((e) => e.text).slice(0, 8).map((e) => (
            <li key={e.id}><span>{e.text}</span><time>{timeAgo(e.ts)}</time></li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
