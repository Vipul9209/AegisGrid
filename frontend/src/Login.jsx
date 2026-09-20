import React, { useEffect, useState } from 'react';
import { api, setToken, ROLE_LABEL } from './api.js';

export default function Login({ onLogin, notice }) {
  const [demo, setDemo] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(notice ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/demo').then((r) => r.ok && setDemo(r.data));
  }, []);

  const submit = async (u = username, p = password) => {
    setBusy(true);
    setError('');
    const r = await api('/auth/login', { method: 'POST', body: { username: u, password: p } });
    setBusy(false);
    if (!r.ok) return setError(r.data.error || 'Could not sign in.');
    setToken(r.data.token);
    onLogin(r.data);
  };

  return (
    <div className="login">
      <section className="login-pitch">
        <div className="brand">
          <span className="logo" aria-hidden />
          <div>
            <h1>AegisGrid</h1>
            <p>Emergency resource coordination</p>
          </div>
        </div>
        <h2>Assemble the fastest feasible response, then let a human decide.</h2>
        <p>
          AegisGrid searches every connected hospital for blood, ICU beds, ventilators, ambulances and specialists, builds ranked response plans against the clock, and reserves resources only after an authorised person approves.
        </p>
        <ul className="pitch-points">
          <li>Plans are computed by deterministic code, so every number can be explained.</li>
          <li>Every action is checked by Cedar policies. AI can recommend, never approve.</li>
          <li>Facilities confirm their part, and the plan adapts when one declines.</li>
        </ul>
      </section>

      <section className="login-card" aria-label="Sign in">
        <h2>Sign in</h2>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>

        {demo?.enabled && (
          <div className="demo-box">
            <h3>Demo accounts</h3>
            <p>Password for all: <code>{demo.password}</code>. This is a public demo network with synthetic data.</p>
            <ul>
              {demo.accounts.map((a) => (
                <li key={a.id}>
                  <button type="button" className="demo-acct" onClick={() => submit(a.id, demo.password)} disabled={busy}>
                    <b>{a.name}</b>
                    <span>{ROLE_LABEL[a.role]}{a.role === 'facility_admin' ? '' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
