import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { root, loadConfig } from './config.js';
import { makeLogger } from './log.js';
import { Viewer } from './viewer.js';
import { Controller } from './controller.js';
import { Detector } from './detector.js';
import { SettingsStore } from './settings.js';
import { platforms } from './platforms.js';
import { createControlServer } from './server.js';

async function main() {
  const config = loadConfig();
  const log = makeLogger(root);
  const settingsStore = new SettingsStore(root, log);
  Object.assign(config, settingsStore.load());
  config.targetUrl = platforms[config.platform].url;
  const viewer = new Viewer(config, root, log);
  const controller = new Controller(config, viewer, log, settingsStore);
  const detector = new Detector(config.opencode, controller, log);
  let stopping;
  const shutdown = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      detector.stop();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      try { await controller.shutdown(); }
      finally { server.close(); log('watcher.stopped'); }
    })();
    return stopping;
  };
  const server = createControlServer({ controller, root, shutdown });
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? `A watcher is already running (or port ${config.controlPort} is occupied).` : error.message)));
    server.listen(config.controlPort, '127.0.0.1', resolve);
  });
  const report = action => void Promise.resolve().then(action).catch(error => console.error(error.message));
  process.on('SIGINT', () => report(shutdown)); process.on('SIGTERM', () => report(shutdown));
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.on('keypress', (_text, key) => {
      if (key?.name === 'q' || (key?.ctrl && key.name === 'c')) report(shutdown);
      else if (!stopping && key?.name === 's') report(() => controller.toggleScroll());
      else if (!stopping && key?.name === 'o') report(() => controller.openManually());
    });
  }
  const url = `http://127.0.0.1:${config.controlPort}`;
  console.log('Reels While Thinking | Dashboard: ' + url);
  console.log('Use Start in the dashboard to enable automation. Q or Ctrl+C quits.');
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { stdio: 'ignore', windowsHide: true });
  browser.on('error', error => log('dashboard.open.error', { message: error.message }));
  log('watcher.started', { platform: config.platform, idleBehavior: config.idleBehavior, popouts: config.popouts });
  await detector.run();
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
