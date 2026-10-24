import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Controller } from '../src/controller.js';
import { SettingsStore } from '../src/settings.js';
import { Viewer } from '../src/viewer.js';
import { resolveTarget, scrollGuard } from '../src/platforms.js';
import { createControlServer } from '../src/server.js';

const noop = () => {};
async function settled(controller) {
  // Actions can schedule playback synchronization behind their own queue entry.
  while (controller.pending) await controller.queue;
}
function fixture(t, idleBehavior = 'pause') {
  const calls = { open: 0, close: 0, scroll: 0, play: [] };
  let open = false, playing = false;
  const viewer = {
    ensure: async () => { calls.open++; open = true; },
    close: async () => { calls.close++; open = playing = false; },
    scroll: async () => calls.scroll++,
    interruptPlayback: () => { playing = false; },
    setPlayback: async (desired, allowed) => {
      playing = open && desired && allowed(); calls.play.push(playing);
      return { state: !open ? 'closed' : playing ? 'playing' : 'paused', error: null };
    },
    get playing() { return playing; },
  };
  const controller = new Controller({ platform: 'subwaySurfers', idleBehavior, controlPort: 4999, autoCloseDelayMs: 20, autoScrollIntervalMs: 5 }, viewer, noop);
  t.after(() => controller.shutdown());
  controller.connection(true);
  return { controller, viewer, calls };
}

test('gameplay starts disabled, ignores the feed toggle, and resumes after idle but not Stop', async t => {
  const { controller: c, viewer, calls } = fixture(t);
  c.activity(1, {}); await settled(c); assert.equal(calls.open, 0);
  c.setAutoScroll(false);
  await c.start(); await settled(c);
  assert.equal(viewer.playing, true); assert.equal(c.status().automation, 'running');
  assert.equal(c.status().scrollingEligible, false); assert.equal(calls.scroll, 0);
  c.activity(2, {}); c.activity(1, {}); await settled(c);
  assert.equal(viewer.playing, true); assert.equal(calls.open, 1);
  c.activity(0, {}); assert.equal(viewer.playing, false); await settled(c);
  assert.equal(calls.close, 0);
  c.activity(1, {}); await settled(c); assert.equal(viewer.playing, true);
  await c.stop(); await settled(c);
  c.activity(0, {}); c.activity(1, {}); await settled(c);
  assert.equal(viewer.playing, false);
  await c.start(); await settled(c); assert.equal(viewer.playing, true);
  assert.equal(calls.scroll, 0);
});

test('gameplay starts idle/paused, Open keeps it open, and Close is delayed/cancellable', async t => {
  const { controller: c, viewer, calls } = fixture(t, 'close');
  await c.start(); await settled(c); assert.equal(viewer.playing, false);
  await c.openManually(); await delay(35); await settled(c); assert.equal(calls.close, 0);
  c.activity(1, {}); await settled(c); assert.equal(viewer.playing, true);
  c.activity(0, {}); assert.equal(viewer.playing, false);
  c.activity(1, {}); await delay(35); await settled(c); assert.equal(calls.close, 0);
  c.activity(0, {}); await delay(35); await settled(c); assert.equal(calls.close, 1);
  c.activity(1, {}); await settled(c); assert.equal(viewer.playing, true);
  await c.stop(); await settled(c); assert.equal(calls.close, 2);
});

test('disconnect pauses, cancels idle closure, and reconnect uses current activity', async t => {
  const { controller: c, viewer, calls } = fixture(t, 'close');
  c.activity(1, {}); await c.start(); await settled(c);
  c.connection(false); assert.equal(viewer.playing, false); await settled(c);
  c.connection(true); await settled(c); assert.equal(viewer.playing, true);
  c.activity(0, {}); c.connection(false); await delay(35); await settled(c);
  assert.equal(calls.close, 0);
  c.connection(true); await delay(35); await settled(c); assert.equal(calls.close, 1);
});

for (const transition of ['stop', 'disconnect', 'idle', 'shutdown']) {
  test(`${transition} during viewer loading prevents late playback`, async t => {
    const { controller: c, viewer, calls } = fixture(t);
    let release;
    const ensure = viewer.ensure;
    viewer.ensure = async () => { await new Promise(resolve => { release = resolve; }); await ensure(); };
    c.activity(1, {});
    const opening = c.start();
    while (!release) await delay(0);
    const stopping = transition === 'stop' ? c.stop() : transition === 'shutdown' ? c.shutdown()
      : transition === 'idle' ? c.activity(0, {}) : c.connection(false);
    release(); await opening; await stopping; await settled(c);
    assert.equal(viewer.playing, false); assert.ok(calls.play.every(playing => !playing));
  });
}

test('manual closure stays closed during the same task; shutdown clears playback work', async t => {
  const { controller: c, viewer, calls } = fixture(t);
  c.activity(1, {}); await c.start(); await settled(c);
  await viewer.close(); const opens = calls.open;
  c.connection(false); c.connection(true); await settled(c);
  assert.equal(calls.open, opens); assert.equal(viewer.playing, false);
  c.activity(0, {}); c.activity(1, {}); await settled(c);
  assert.equal(calls.open, opens + 1);
  await c.shutdown(); assert.equal(viewer.playing, false);
  const plays = calls.play.length; await delay(550);
  assert.equal(calls.play.length, plays);
});

test('gameplay selection persists, uses the configured port, and preserves feed behavior', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-gameplay-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new SettingsStore(root);
  const { controller: c, calls } = fixture(t);
  c.settingsStore = store;
  await c.updateSettings({ platform: 'subwaySurfers' }); await settled(c);
  assert.equal(store.load().platform, 'subwaySurfers');
  assert.equal(c.config.targetUrl, 'http://127.0.0.1:4999/gameplay.html');
  assert.equal(resolveTarget('subwaySurfers', { controlPort: 5432 }), 'http://127.0.0.1:5432/gameplay.html');
  assert.equal(scrollGuard('subwaySurfers'), 'false');
  c.activity(1, {}); await c.start(); await settled(c);
  await assert.rejects(c.updateSettings({ platform: 'youtube' }), /Stop/);
  await c.stop(); c.setAutoScroll(false);
  await c.updateSettings({ platform: 'youtube' }); await settled(c);
  assert.equal(c.status().playback, null); assert.equal(c.autoScroll, false);
  await c.start(); c.setAutoScroll(true); await delay(20); await settled(c);
  assert.ok(calls.scroll > 0);
});

test('viewer never dispatches gameplay keys and rechecks eligibility during a play command', async () => {
  let allowed = true, release;
  const expressions = [];
  const page = { alive: true, send: async (method, params) => {
    assert.equal(method, 'Runtime.evaluate'); expressions.push(params.expression);
    if (expressions.length === 1) await new Promise(resolve => { release = resolve; });
    return { result: { value: { state: 'paused', error: null } } };
  } };
  const viewer = new Viewer({ platform: 'subwaySurfers', controlPort: 4097 }, '', noop);
  viewer.windows = [{ page }];
  await viewer.scroll(); assert.equal(expressions.length, 0);
  const playing = viewer.setPlayback(true, () => allowed);
  allowed = false; release(); await playing;
  assert.equal(expressions.length, 2);
  assert.match(expressions[1], /setPlayback\(false\)/);
});

test('an unloaded player times out visibly and can recover after its scripts load', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let ready = false;
  const page = { alive: true, send: async () => ({ result: { value: ready
    ? { state: 'paused', error: null } : { state: 'loading', error: null, ready: false } } }) };
  const viewer = new Viewer({ platform: 'subwaySurfers', controlPort: 4097 }, '', noop);
  viewer.windows = [{ page }];
  assert.equal((await viewer.setPlayback(false)).state, 'loading');
  t.mock.timers.tick(11000);
  assert.match((await viewer.setPlayback(false)).error, /did not load/);
  ready = true;
  assert.deepEqual(await viewer.setPlayback(false), { state: 'paused', error: null });
});

test('media route streams only its clip, handles ranges/HEAD, and reports missing/empty media', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-gameplay-media-'));
  const file = path.join(root, 'runtime/media/subway-surfers.mp4');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const server = createControlServer({ controller: { status: () => ({}) }, root, shutdown: noop });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = base + '/api/media/subway-surfers';
  assert.equal((await fetch(url)).status, 404);
  const data = Buffer.from('0123456789abcdefghijklmnopqrstuv');
  fs.writeFileSync(file, data);
  const full = await fetch(url);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), data);
  const head = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=2-5' } });
  assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), data.length);
  assert.equal(await head.text(), '');
  for (const [range, start, end] of [['bytes=2-5', 2, 5], ['bytes=4-', 4, 31], ['bytes=-6', 26, 31], ['bytes=28-100', 28, 31]]) {
    const response = await fetch(url, { headers: { Range: range } });
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/32`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), data.subarray(start, end + 1));
  }
  for (const range of ['bytes=100-', 'bytes=8-3', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'bytes=9007199254740992-', 'bogus']) {
    const response = await fetch(url, { headers: { Range: range } });
    assert.equal(response.status, 416, range); assert.equal(response.headers.get('content-range'), 'bytes */32');
    await response.arrayBuffer();
  }
  for (const route of ['/api/media/other', '/api/media/subway-surfers?path=../../config.json', '/api/media/%2e%2e%2fconfig.json']) assert.equal((await fetch(base + route)).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const foreignHost = await new Promise((resolve, reject) => {
    http.get(url, { headers: { Host: 'example.com' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(foreignHost, 403);
  fs.writeFileSync(file, ''); assert.equal((await fetch(url)).status, 503);
});
