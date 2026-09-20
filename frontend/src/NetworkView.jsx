import React, { useMemo, useState } from 'react';

const tone = (f) => (f.stale ? 'stale' : f.icuFree === 0 ? 'red' : f.icuFree === 1 ? 'amber' : 'green');
const TONE_LABEL = { green: 'ICU capacity', amber: 'One ICU bed', red: 'No ICU beds', stale: 'Data stale' };

export default function NetworkView({ network, onOpenFacility }) {
  const [sel, setSel] = useState(null);
  const box = { minLat: 12.83, maxLat: 13.07, minLng: 77.52, maxLng: 77.77 };
  const W = 720, H = 500, padX = 70, pad = 34;
  const x = (lng) => padX + ((lng - box.minLng) / (box.maxLng - box.minLng)) * (W - padX * 2);
  const y = (lat) => pad + (1 - (lat - box.minLat) / (box.maxLat - box.minLat)) * (H - pad * 2);
  const chosen = network.find((f) => f.id === sel) ?? null;
  const totals = useMemo(() => ({
    icu: network.reduce((a, f) => a + f.icuFree, 0),
    stale: network.filter((f) => f.stale).length,
    low: network.filter((f) => !f.stale && f.icuFree === 0).length,
  }), [network]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>Network status</h2>
          <p>{network.length} facilities. {totals.icu} ICU beds free in total, {totals.low} facilities with none, {totals.stale} with stale data.</p>
        </div>
      </header>

      <div className="net-grid">
        <div className="net-map">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map of facilities colored by ICU availability">
            <rect width={W} height={H} rx="12" className="map-bg" />
            {network.map((f) => {
              const t = tone(f);
              return (
                <g key={f.id} className={`fnode ${t} ${sel === f.id ? 'sel' : ''}`} tabIndex={0} role="button" aria-label={`${f.name}, ${f.icuFree} ICU beds free`} onClick={() => setSel(f.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSel(f.id)}>
                  <circle cx={x(f.lng)} cy={y(f.lat)} r={9 + Math.min(f.icuFree, 4) * 2.5} className="fnode-c" />
                  <text x={x(f.lng)} y={y(f.lat) + 4} textAnchor="middle" className="fnode-n">{f.icuFree}</text>
                  <text x={x(f.lng)} y={y(f.lat) + 26} textAnchor="middle" className="fnode-l">{f.name.split(' ').slice(0, 2).join(' ').slice(0, 17)}</text>
                </g>
              );
            })}
          </svg>
          <ul className="map-legend">
            {Object.entries(TONE_LABEL).map(([k, v]) => <li key={k}><i className={`swatch ${k}`} />{v}</li>)}
            <li className="muted">Number inside = ICU beds free</li>
          </ul>
        </div>

        <aside className="net-detail">
          {chosen ? (
            <>
              <h3>{chosen.name}</h3>
              <p className="muted">{chosen.region} · {chosen.kind === 'bloodbank' ? 'Blood bank' : chosen.kind}</p>
              <dl className="kv">
                <div><dt>ICU beds</dt><dd>{chosen.icuFree} of {chosen.icuTotal} free</dd></div>
                <div><dt>Ventilators free</dt><dd>{chosen.ventFree}</dd></div>
                <div><dt>Ambulances free</dt><dd>{chosen.ambFree}</dd></div>
                <div><dt>O-negative units</dt><dd>{chosen.oNeg}</dd></div>
                <div><dt>Phone</dt><dd>{chosen.phone}</dd></div>
                <div><dt>Data feed</dt><dd className={chosen.stale ? 'bad-text' : ''}>{chosen.connected ? `synced ${chosen.ageMin === 0 ? 'just now' : `${chosen.ageMin} min ago`}` : `disconnected, last sync ${chosen.ageMin} min ago`}</dd></div>
              </dl>
              {chosen.pendingRequests > 0 && <p className="banner warn small-banner">{chosen.pendingRequests} request(s) waiting for this facility.</p>}
              <button className="secondary" onClick={() => onOpenFacility(chosen.id)}>Open facility desk</button>
            </>
          ) : (
            <p className="muted">Select a facility on the map to see its inventory and how fresh its data is.</p>
          )}
        </aside>
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr><th>Facility</th><th>ICU free</th><th>Vent</th><th>Amb</th><th>O-neg</th><th>All blood</th><th>Data</th></tr>
          </thead>
          <tbody>
            {network.map((f) => (
              <tr key={f.id} className={f.stale ? 'row-stale' : ''} onClick={() => setSel(f.id)}>
                <td><b>{f.name}</b></td>
                <td>{f.icuFree}/{f.icuTotal}</td>
                <td>{f.ventFree}</td>
                <td>{f.ambFree}</td>
                <td className={f.oNeg === 0 ? 'bad-text' : ''}>{f.oNeg}</td>
                <td>{f.bloodTotal}</td>
                <td><span className={`pill ${f.stale ? 'bad' : 'ok'}`}>{f.stale ? `${f.ageMin} min old` : f.ageMin === 0 ? 'live' : `${f.ageMin} min`}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">Demo network: facilities and stock are synthetic and heartbeats are simulated. Real facilities update through the facility desk or push through the keyed ingest API.</p>
    </div>
  );
}
