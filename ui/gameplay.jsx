import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './gameplay.css';

function Gameplay() {
  const video = useRef(null);
  const [state, setState] = useState({ state: 'loading', error: null });
  useEffect(() => {
    const element = video.current;
    const abort = new AbortController();
    let desired = false, revision = 0, failure = null, pending = false;
    const snapshot = () => ({
      state: failure ? 'error' : !element.currentSrc || element.readyState < 2 ? 'loading' : !element.paused ? 'playing' : 'paused',
      error: failure,
    });
    const report = () => { const value = snapshot(); if (!abort.signal.aborted) setState(value); return value; };
    const play = () => {
      if (!desired || pending || failure || !element.currentSrc || !element.paused) return;
      const current = revision;
      pending = true;
      element.play().then(() => {
        if (!desired || current !== revision || abort.signal.aborted) element.pause();
      }).catch(error => {
        if (desired && current === revision) failure = error.name === 'NotSupportedError'
          ? 'This clip cannot be played. Use an MP4 with H.264 video.'
          : 'Playback could not start. Reload the player to try again.';
      }).finally(() => { pending = false; report(); });
    };
    window.reelsPlayer = {
      setPlayback(playing) {
        if (desired !== playing) revision++;
        desired = playing;
        if (!playing) element.pause();
        else play();
        return report();
      },
      status: snapshot,
    };
    const update = () => { if (desired) play(); report(); };
    const failed = () => {
      failure = 'This clip cannot be played. Check that it is a supported MP4, then reload the player.';
      element.pause(); report();
    };
    for (const event of ['loadeddata', 'playing', 'pause', 'waiting', 'canplay']) element.addEventListener(event, update);
    element.addEventListener('error', failed);
    fetch('/api/media/subway-surfers', { method: 'HEAD', signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error(response.status === 404
        ? 'No gameplay clip yet. Add your clip using the README setup steps.'
        : 'The gameplay clip cannot be read. Check or replace the file.');
      element.src = '/api/media/subway-surfers';
      element.load();
    }).catch(error => { if (!abort.signal.aborted) { failure = error.message; report(); } });
    return () => {
      abort.abort(); desired = false; revision++;
      for (const event of ['loadeddata', 'playing', 'pause', 'waiting', 'canplay']) element.removeEventListener(event, update);
      element.removeEventListener('error', failed);
      element.pause(); delete window.reelsPlayer;
    };
  }, []);
  return <main>
    <video ref={video} muted loop playsInline preload="auto" aria-label="Subway Surfers gameplay" />
    <header><span>SUBWAY SURFERS</span><span className="pill">{state.error ? 'Unavailable' : state.state === 'playing' ? 'Playing' : state.state === 'loading' ? 'Loading' : 'Paused'}</span></header>
    {state.error ? <section className="message" role="alert"><h1>Gameplay unavailable</h1><p>{state.error}</p><button onClick={() => location.reload()}>Reload player</button></section>
      : state.state !== 'playing' && <section className="message" role="status"><h1>{state.state === 'loading' ? 'Loading gameplay…' : 'Ready for the next run'}</h1><p>{state.state === 'loading' ? 'Getting your clip ready.' : 'Playback follows OpenCode. Use Start in the dashboard to enable it.'}</p></section>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Gameplay />);
