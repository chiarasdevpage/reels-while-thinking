import net from 'node:net';
import readline from 'node:readline';
import { root, loadConfig } from './config.js';
import { makeLogger } from './log.js';
import { Viewer, findBrowser } from './viewer.js';
import { Controller } from './controller.js';
import { Detector } from './detector.js';

async function main() {
  const config = loadConfig();
  findBrowser(config.browserPath);
  const lock = net.createServer(socket => socket.end());
  await new Promise((resolve, reject) => {
    lock.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? `A watcher is already running (or port ${config.controlPort} is occupied).` : error.message)));
    lock.listen(config.controlPort, '127.0.0.1', resolve);
  });
  const log = makeLogger(root);
  const viewer = new Viewer(config, root, log);
  const controller = new Controller(config, viewer, log);
  const detector = new Detector(config.opencode, controller, log);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    detector.stop();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    await controller.stop();
    lock.close();
    log('watcher.stopped');
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.on('keypress', (_text, key) => {
      if (key?.name === 'q' || (key?.ctrl && key.name === 'c')) void stop();
      else if (!stopping && key?.name === 's') controller.toggleScroll();
      else if (!stopping && key?.name === 'o') void controller.openManually();
    });
  }
  console.log('Reels While Thinking | O: open/login | S: toggle scrolling | Q or Ctrl+C: stop and close popouts');
  log('watcher.started', { autoScroll: config.autoScroll, autoClose: config.autoClose, popouts: config.popouts });
  await detector.run();
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
