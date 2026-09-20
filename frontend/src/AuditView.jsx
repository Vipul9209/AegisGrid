import React, { useEffect, useState } from 'react';
import { api, ROLE_LABEL } from './api.js';

const FILTERS = [
  ['all', 'Everything'],
  ['policy', 'Policy decisions'],
  ['deny', 'Blocked'],
  ['approvals', 'Approvals and confirmations'],
];

export default function AuditView() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const load = () => api('/audit').then((r) => r.ok && setRows(r.data));
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, []);

  const shown = rows.filter((e) =>
    filter === 'all' ? true :
    filter === 'policy' ? e.type.startsWith('POLICY') :
    filter === 'deny' ? e.type === 'POLICY_DENY' :
    ['POLICY_ALLOW', 'FACILITY_CONFIRMED', 'FACILITY_DECLINED', 'EMERGENCY_CREATED'].includes(e.type));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>Audit trail</h2>
          <p>Every action, who did it, and what Cedar decided. Newest first.</p>
        </div>
        <div className="filters" role="group" aria-label="Filter">
          {FILTERS.map(([k, v]) => <button key={k} className={`ghost small ${filter === k ? 'on-dark' : ''}`} onClick={() => setFilter(k)}>{v}</button>)}
        </div>
      </header>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>Time</th><th>Who</th><th>What happened</th><th>Result</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan="4" className="muted">No matching events.</td></tr>}
            {shown.map((e) => (
              <tr key={e.id} className={e.type === 'POLICY_DENY' ? 'row-deny' : ''}>
                <td className="nowrap">{new Date(e.ts).toLocaleTimeString()}</td>
                <td className="nowrap">{e.actor ? <><b>{e.actor.name}</b><br /><small className="muted">{ROLE_LABEL[e.actor.role] ?? e.actor.role}</small></> : <span className="muted">System</span>}</td>
                <td>{e.text}</td>
                <td>{e.type === 'POLICY_DENY' ? <span className="pill bad">Blocked</span> : e.type === 'POLICY_ALLOW' ? <span className="pill ok">Allowed</span> : <span className="pill neutral">{e.type.replaceAll('_', ' ').toLowerCase()}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
