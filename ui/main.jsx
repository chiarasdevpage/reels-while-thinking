import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const names = { instagram: 'Instagram Reels', youtube: 'YouTube Shorts', tiktok: 'TikTok' };
function App() {
  const [state, setState] = useState(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState('');
  const [commands, setCommands] = useState(0);
  const [quitting, setQuitting] = useState(false);
  const stopped = useRef(false);
  const version = useRef(0);
  const mutations = useRef(0);
  useEffect(() => {
    let cancelled = false, timer;
    async function poll() {
      const revision = version.current;
      try {
        if (!stopped.current && !mutations.current) {
          const response = await fetch('/api/status', { signal: AbortSignal.timeout(4000) });
          if (!response.ok) throw new Error('Cannot read dashboard status');
          const value = await response.json();
          if (!cancelled && !stopped.current && revision === version.current) { setState(value); setOnline(true); }
        }
      } catch {
        if (!cancelled && !stopped.current && revision === version.current) setOnline(false);
      } finally { if (!cancelled && !stopped.current) timer = setTimeout(poll, 1000); }
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  async function command(route, method = 'POST', body = {}) {
    setError(''); mutations.current++; version.current++; setCommands(count => count + 1);
    const isQuit = route === 'shutdown';
    if (isQuit) setQuitting(true);
    try {
      const response = await fetch('/api/' + route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Action failed');
      // A fresh GET after mutations is authoritative; commands may finish in a different order.
      if (isQuit) { stopped.current = true; setState(result); }
      else {
        const latest = await fetch('/api/status');
        if (latest.ok && !stopped.current) setState(await latest.json());
      }
      setOnline(true);
    } catch (err) { setError(err.message); }
    finally { mutations.current--; version.current++; setCommands(count => count - 1); setQuitting(false); }
  }
  const busy = commands > 0 || state?.pending;
  const unavailable = !online || !state || state.shutdown || quitting;
  const running = state?.scrollingEligible;
  const disabledReason = !online ? 'Connecting to the local watcher…' : state?.shutdown ? 'Watcher stopped. Launch the app to reconnect.' : !state?.enabled ? 'Ready when you are. Press Start to enable automation.' : !state?.connected ? 'Waiting for OpenCode to connect.' : state.activity === 'idle' ? 'Waiting for OpenCode to start working.' : !state.autoScroll ? 'Auto-scroll is off. Window automation is still enabled.' : 'Automatic scrolling is enabled while OpenCode works.';
  return <main>
    <header><div className="brand"><span className="mark">↧</span><span>REELS WHILE THINKING</span></div><span className="local"><i className={online ? 'dot online' : 'dot'} />Local dashboard</span></header>
    <section className="intro"><p className="eyebrow">A LITTLE BREAK, IN SYNC</p><h1>Your feed, in sync.</h1><p>Short-form video while OpenCode handles the work.</p></section>
    <section className="panel" aria-label="Automation controls">
      <div className="panel-heading"><h2>Control room</h2><span className={'badge ' + (running && online ? 'active' : '')}><i className="dot" />{!online ? 'Offline' : state?.shutdown ? 'Stopped' : running ? 'Running' : 'Paused'}</span></div>
      <div className="statuses"><div><span>OpenCode</span><strong>{!online ? 'Unknown' : !state?.connected ? 'Disconnected' : state.activity === 'typing' ? 'Typing' : 'Idle'}</strong><small>Includes tools and permission waits</small></div><div><span>Selected platform</span><strong>{names[state?.settings.platform] || '—'}</strong><small>{state?.settings.idleBehavior === 'close' ? 'Close viewers when idle' : 'Leave viewers open when idle'}</small></div></div>
      <div className="fields"><label>Platform<select aria-label="Platform" value={state?.settings.platform || 'instagram'} disabled={unavailable || busy || state?.enabled} onChange={e => command('settings', 'PATCH', { platform: e.target.value })}>{Object.entries(names).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select><small>Stop automation to switch platforms.</small></label>
      <label>When idle or stopped<select aria-label="When idle or stopped" value={state?.settings.idleBehavior || 'pause'} disabled={unavailable || busy} onChange={e => command('settings', 'PATCH', { idleBehavior: e.target.value })}><option value="pause">Pause · keep viewers open</option><option value="close">Close · close viewers</option></select><small>Idle resumes automatically. Stop waits for Start.</small></label></div>
      <label className="toggle-row"><span><strong>Auto-scroll</strong><small>Advance videos while OpenCode is active.</small></span><input type="checkbox" role="switch" aria-label="Auto-scroll" checked={state?.autoScroll ?? true} disabled={unavailable || busy} onChange={e => command('auto-scroll', 'PUT', { enabled: e.target.checked })} /></label>
      <div className="actions"><button className="primary" disabled={unavailable || busy || state?.enabled} onClick={() => command('start')}>▶ Start</button><button disabled={unavailable} onClick={() => command('stop')}>■ Stop</button></div>
      <p className="status-message" role="status">{busy ? 'Applying your changes…' : disabledReason}</p>
      {(error || state?.error) && <p className="error" role="alert">{error || state.error}</p>}
      <div className="secondary"><button disabled={unavailable || busy} onClick={() => command('open')}>Open / Login ↗</button><button disabled={unavailable || busy} onClick={() => command('shutdown')}>Quit watcher</button></div>
    </section>
    <footer>Sign in directly in the viewer. Your platform and idle preference save automatically.</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
