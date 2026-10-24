// Real Chromium playback against an isolated copy of the app and a generated clip.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig, root } from '../src/config.js';
import { Controller } from '../src/controller.js';
import { Viewer } from '../src/viewer.js';
import { resolveTarget } from '../src/platforms.js';
import { createControlServer } from '../src/server.js';
import { createServer as createViteServer } from 'vite';

const work = path.join(root, 'runtime', 'gameplay-smoke');
const media = path.join(work, 'runtime/media/subway-surfers.mp4');
fs.mkdirSync(path.dirname(media), { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(work, 'dist'), { recursive: true });
fs.rmSync(media, { force: true });
const config = { ...loadConfig(), platform: 'subwaySurfers', idleBehavior: 'pause', popouts: 2, autoCloseDelayMs: 500 };
const viewer = new Viewer(config, work, () => {});
const controller = new Controller(config, viewer, () => {});
const server = createControlServer({ controller, root: work, shutdown: () => controller.shutdown() });
let vite;
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
config.controlPort = server.address().port;
config.targetUrl = resolveTarget(config.platform, config);
const evaluate = async (expression, window = viewer.windows[0]) => {
  const result = await window.page.send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
};
async function until(predicate, description, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await delay(50); }
  throw new Error(`Timed out: ${description}; status=${JSON.stringify(controller.status())}`);
}
const videoState = '(() => {const v=document.querySelector("video");return v && {time:v.currentTime,paused:v.paused,frames:v.getVideoPlaybackQuality().totalVideoFrames,muted:v.muted,loop:v.loop};})()';
async function paused() {
  await until(async () => (await evaluate(videoState))?.paused, 'video pauses');
  const before = await evaluate(videoState); await delay(250);
  const after = await evaluate(videoState);
  assert.ok(Math.abs(after.time - before.time) < 0.03, 'Paused playback must not advance');
}
try {
  controller.connection(true); controller.activity(1, {}); controller.setAutoScroll(false);
  await controller.start();
  await until(() => controller.status().error?.includes('No gameplay clip'), 'missing clip reaches dashboard');
  assert.match(await evaluate('document.body.innerText'), /No gameplay clip/);
  await controller.stop();

  fs.writeFileSync(media, 'This is not a video');
  for (const window of viewer.windows) await window.page.send('Page.reload');
  await until(() => controller.status().error?.includes('supported MP4'), 'invalid clip reaches dashboard');
  fs.copyFileSync(path.join(root, 'test/fixtures/gameplay.mp4'), media);
  for (const window of viewer.windows) await window.page.send('Page.reload');
  await until(() => controller.status().playback.state === 'paused' && !controller.status().error, 'reload recovers valid clip');
  await paused();

  vite = await createViteServer({ configFile: path.join(root, 'vite.config.js'), root,
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: `http://127.0.0.1:${config.controlPort}` } } },
  });
  await vite.listen();
  const devOrigin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  assert.match(await (await fetch(devOrigin + '/gameplay.html')).text(), /\/ui\/gameplay.jsx/);
  assert.match(await (await fetch(devOrigin + '/ui/gameplay.jsx')).text(), /createRoot/);
  const range = await fetch(devOrigin + '/api/media/subway-surfers', { headers: { Range: 'bytes=8-31' } });
  assert.equal(range.status, 206); assert.match(range.headers.get('content-range'), /^bytes 8-31\//);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), fs.readFileSync(media).subarray(8, 32));
  const head = await fetch(devOrigin + '/api/media/subway-surfers', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), fs.statSync(media).size);
  const setting = await fetch(devOrigin + '/api/auto-scroll', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: devOrigin }, body: '{"enabled":false}' });
  assert.equal(setting.status, 200); await setting.arrayBuffer();

  await controller.start();
  await until(() => controller.status().automation === 'running', 'actual playback reported');
  for (const window of viewer.windows) {
    await until(async () => { const value = await evaluate(videoState, window); return !value.paused && value.frames > 2 && value.time > 0.1; }, 'decoded frames advance');
    const state = await evaluate(videoState, window); assert.equal(state.muted, true); assert.equal(state.loop, true);
    await evaluate('window.loopObserved=false; window.lastVideoTime=0; document.querySelector("video").addEventListener("timeupdate",e=>{const t=e.target.currentTime;if(t < window.lastVideoTime - 0.5) window.loopObserved=true;window.lastVideoTime=t;});', window);
  }
  await until(async () => await evaluate('window.loopObserved'), 'clip loops', 5000);
  const screenshot = await viewer.windows[0].page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(work, 'player.png'), Buffer.from(screenshot.data, 'base64'));
  assert.equal(await evaluate('getComputedStyle(document.querySelector("video")).objectFit'), 'cover');

  controller.activity(0, {}); await paused();
  controller.activity(1, {}); await until(async () => !(await evaluate(videoState)).paused, 'resume after idle');
  controller.connection(false); await paused();
  controller.connection(true); await until(async () => !(await evaluate(videoState)).paused, 'resume after reconnect');
  await controller.stop(); await paused();
  controller.activity(0, {}); controller.activity(1, {}); await delay(600); await paused();
  await controller.start(); await until(async () => !(await evaluate(videoState)).paused, 'explicit Start resumes');

  await viewer.closeOne(viewer.windows[1]);
  controller.connection(false); controller.connection(true); await delay(600);
  assert.equal(viewer.windows[1].page.alive, false, 'Do not reopen a manually closed viewer during the task');
  controller.activity(0, {}); controller.activity(1, {});
  await until(() => viewer.windows[1].page.alive, 'next task restores manually closed viewer');

  await controller.updateSettings({ idleBehavior: 'close' });
  controller.activity(0, {}); await paused();
  controller.activity(1, {}); await delay(600);
  assert.equal(viewer.windows.length, 2, 'New activity cancels delayed closure');
  controller.activity(0, {}); await until(() => viewer.windows.length === 0, 'idle Close');
  controller.activity(1, {}); await until(() => controller.status().automation === 'running', 'reopen on a new task');
  await controller.stop(); assert.equal(viewer.windows.length, 0);
  console.log('PASS: missing/invalid clip recovery, decoded playback in two viewers, mute, loop, idle/Stop/disconnect pauses, resume, manual closure, delayed Close, and Vite player/media/control proxy');
} finally {
  await vite?.close();
  await controller.shutdown();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
