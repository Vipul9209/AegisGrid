import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken, ROLE_LABEL } from './api.js';
import Login from './Login.jsx';
import CommandCenter from './CommandCenter.jsx';
import NetworkView from './NetworkView.jsx';
import FacilityView from './FacilityView.jsx';
import AuditView from './AuditView.jsx';

export default function App() {
  const [session, setSession] = useState(null); // {user, capabilities}
  const [booting, setBooting] = useState(!!getToken());
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me').then((r) => {
      if (r.ok) setSession({ user: r.data.user, capabilities: r.data.capabilities });
      else setToken(null);
      setBooting(false);
    });
  }, []);

  useEffect(() => {
    const onUnauth = () => { setToken(null); setSession(null); setNotice('Your session ended. Sign in again.'); };
    window.addEventListener('aegis-unauthorized', onUnauth);
    return () => window.removeEventListener('aegis-unauthorized', onUnauth);
  }, []);

  if (booting) return <div className="boot">Loading…</div>;
  if (!session) return <Login notice={notice} onLogin={(d) => { setNotice(''); setSession({ user: d.user, capabilities: d.capabilities }); }} />;
  return <Shell key={session.user.id} session={session} setSession={setSession} />;
}

function Shell({ session, setSession }) {
  const { user, capabilities: caps } = session;
  const [tab, setTab] = useState(user.role === 'facility_admin' ? 'facility' : 'command');
  const [facilities, setFacilities] = useState([]);
  const [network, setNetwork] = useState([]);
  const [dash, setDash] = useState(null);
  const [ems, setEms] = useState([]);
  const [feed, setFeed] = useState({ events: [], outbox: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [facilityId, setFacilityId] = useState(user.facility !== 'NETWORK' ? user.facility : 'F01');
  const [toast, setToast] = useState(null);
  const [offline, setOffline] = useState(false);
  const [lastOk, setLastOk] = useState(Date.now());
  const [menu, setMenu] = useState(false);
  const [demo, setDemo] = useState(null);
  const toastTimer = useRef(null);

  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    const [d, e, ev, n] = await Promise.all([api('/dashboard'), api('/emergencies'), api('/events'), api('/network')]);
    if (!d.ok) return setOffline(d.status === 0 || d.status >= 500);
    setDash(d.data); setEms(e.data); setFeed(ev.data); setNetwork(n.data);
    setOffline(false);
    setLastOk(Date.now());
  }, []);

  useEffect(() => {
    api('/facilities').then((r) => r.ok && setFacilities(r.data));
    api('/auth/demo').then((r) => r.ok && setDemo(r.data));
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [refresh]);

  const signOut = () => { setToken(null); setSession(null); };
  const switchTo = async (username) => {
    setMenu(false);
    const r = await api('/auth/login', { method: 'POST', body: { username, password: demo.password } });
    if (!r.ok) return flash(r.data.error);
    setToken(r.data.token);
    setSession({ user: r.data.user, capabilities: r.data.capabilities });
  };

  const tabs = [
    ['command', 'Command center'],
    ['network', 'Network'],
    ['facility', user.role === 'facility_admin' ? 'My facility' : 'Facility desk'],
    ['audit', 'Audit trail'],
  ];
  const initials = user.name.replace(/^Dr\. /, '').split(' ').map((w) => w[0]).slice(0, 2).join('');
  const facName = user.facility === 'NETWORK' ? 'Regional network' : facilities.find((f) => f.id === user.facility)?.name ?? '';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand small">
          <span className="logo" aria-hidden />
          <b>AegisGrid</b>
        </div>
        <nav aria-label="Sections">
          {tabs.map(([k, v]) => (
            <button key={k} className={tab === k ? 'sel' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
              {v}
              {k === 'command' && dash?.awaitingApproval > 0 && caps.approve && <span className="badge">{dash.awaitingApproval}</span>}
            </button>
          ))}
        </nav>
        <div className="top-right">
          <span className={`live ${offline ? 'off' : ''}`} title={`Last update ${Math.round((Date.now() - lastOk) / 1000)}s ago`}>
            <i aria-hidden />{offline ? 'Offline' : 'Live'}
          </span>
          <div className="user-menu">
            <button className="user-chip" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu">
              <span className="avatar" aria-hidden>{initials}</span>
              <span className="who"><b>{user.name}</b><small>{ROLE_LABEL[user.role]} · {facName}</small></span>
            </button>
            {menu && (
              <div className="menu" role="menu">
                {demo?.enabled && <p className="menu-title">Switch demo account</p>}
                {demo?.enabled && demo.accounts.filter((a) => a.id !== user.id).map((a) => (
                  <button role="menuitem" key={a.id} onClick={() => switchTo(a.id)}><b>{a.name}</b><small>{ROLE_LABEL[a.role]}</small></button>
                ))}
                <button role="menuitem" className="signout" onClick={signOut}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {offline && <div className="banner bad top-banner" role="alert">Cannot reach the AegisGrid API. Retrying…</div>}
      {toast && <div className="toast" role="status">{toast}</div>}

      <div className="content">
        {tab === 'command' && (
          <CommandCenter user={user} caps={caps} facilities={facilities} ems={ems} dash={dash} feed={feed} refresh={refresh} flash={flash} selectedId={selectedId} setSelectedId={setSelectedId} />
        )}
        {tab === 'network' && <NetworkView network={network} onOpenFacility={(id) => { setFacilityId(id); setTab('facility'); }} />}
        {tab === 'facility' && facilities.length > 0 && (
          <FacilityView user={user} caps={caps} facilities={facilities} facilityId={facilityId} setFacilityId={setFacilityId} flash={flash} refreshShell={refresh} />
        )}
        {tab === 'audit' && <AuditView />}
      </div>
    </div>
  );
}
