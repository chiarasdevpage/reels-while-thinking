import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { Controller } from '../src/controller.js';
import { SettingsStore } from '../src/settings.js';
import { createControlServer } from '../src/server.js';
import { platforms, scrollGuard } from '../src/platforms.js';

const noop = () => {};
function fixture(idleBehavior = 'pause') {
  const calls = { open: 0, close: 0, scroll: 0 };
  const viewer = { ensure: async () => calls.open++, close: async () => calls.close++, scroll: async allowed => { if (allowed()) calls.scroll++; } };
  const controller = new Controller({ platform: 'instagram', idleBehavior, autoScrollIntervalMs: 10, autoCloseDelayMs: 15 }, viewer, noop);
  controller.connection(true);
  return { calls, viewer, controller };
}
test('launch waits for Start; Start uses already-active detector state', async () => {
  const { calls, controller: c } = fixture();
  try {
    c.activity(1, {}); await c.queue; assert.equal(calls.open, 0);
    await c.start(); await delay(35); assert.equal(calls.open, 1); assert.ok(calls.scroll > 0);
  } finally { await c.shutdown(); }
});
for (const behavior of ['pause', 'close']) {
  test(behavior + ': idle resumes automatically; manual Stop requires Start', async () => {
    const { calls, controller: c } = fixture(behavior);
    try {
      c.activity(1, {}); await c.start();
      c.activity(0, {}); await delay(30); await c.queue;
      assert.equal(calls.close, behavior === 'close' ? 1 : 0);
      c.activity(1, {}); await c.queue; assert.equal(calls.open, 2);
      await c.stop();
      const previous = { ...calls };
      c.activity(0, {}); c.activity(1, {}); await delay(30);
      assert.deepEqual(calls, previous); assert.equal(c.status().enabled, false);
      assert.equal(calls.close, behavior === 'close' ? 2 : 0);
      await c.start(); assert.equal(calls.open, 3);
    } finally { await c.shutdown(); }
  });
  test(behavior + ': Stop during browser startup prevents late scrolling', async () => {
    const { calls, viewer, controller: c } = fixture(behavior);
    let release;
    viewer.ensure = () => new Promise(resolve => { release = () => { calls.open++; resolve(); }; });
    c.activity(1, {});
    const opening = c.start(); await delay(0);
    const stopping = c.stop(); release();
    await Promise.all([opening, stopping]); await delay(25);
    assert.equal(calls.scroll, 0); assert.equal(calls.close, behavior === 'close' ? 1 : 0);
    await c.shutdown();
  });
}
test('disconnect cancels idle closure; reconnect resumes from current state', async () => {
  const { controller: c, calls } = fixture('close');
  try {
    c.activity(1, {}); await c.start();
    c.activity(0, {}); c.connection(false);
    await delay(30); assert.equal(calls.close, 0); assert.equal(c.status().activity, 'disconnected');
    c.connection(true); await delay(30); assert.equal(calls.close, 1);
  } finally { await c.shutdown(); }
});
test('live behavior changes cancel/schedule closing; stopped settings never open viewers', async () => {
  const { controller: c, calls } = fixture();
  try {
    await c.start(); await c.updateSettings({ idleBehavior: 'close' });
    await c.updateSettings({ idleBehavior: 'pause' });
    await delay(30); assert.equal(calls.close, 0);
    await c.updateSettings({ idleBehavior: 'close' });
    await delay(30); assert.equal(calls.close, 1);
    await c.stop(); const count = calls.open;
    await c.updateSettings({ idleBehavior: 'pause' }); assert.equal(calls.open, count);
  } finally { await c.shutdown(); }
});
test('Open/Login while idle stays open for manual login', async () => {
  const { controller: c, calls } = fixture('close');
  try { await c.start(); await c.openManually(); await delay(30); assert.equal(calls.close, 0); }
  finally { await c.shutdown(); }
});
test('platform switch requires Stop, closes viewers, and persists before publishing', async () => {
  const { controller: c, calls } = fixture();
  try {
    await c.start();
    await assert.rejects(c.updateSettings({ platform: 'youtube' }), /Stop/);
    await c.stop(); await c.updateSettings({ platform: 'youtube' });
    assert.equal(c.settings.platform, 'youtube'); assert.equal(c.config.targetUrl, platforms.youtube.url);
    assert.equal(calls.close, 1);
    c.settingsStore = { save() { throw new Error('Disk unavailable'); } };
    await assert.rejects(c.updateSettings({ idleBehavior: 'close' }), /Disk/);
    assert.equal(c.settings.idleBehavior, 'pause'); assert.equal(c.status().error, 'Disk unavailable');
  } finally { await c.shutdown(); }
});
test('browser failures reach callers and status; queue remains usable', async () => {
  const { controller: c, viewer } = fixture();
  try {
    viewer.ensure = async () => { throw new Error('Browser unavailable'); };
    await assert.rejects(c.start(), /Browser unavailable/);
    assert.equal(c.status().error, 'Browser unavailable');
    await c.stop(); assert.equal(c.status().pending, false);
  } finally { await c.shutdown(); }
});
test('settings survive reload, default invalid fields, and preserve prior file on failed writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-settings-'));
  try {
    const store = new SettingsStore(root);
    assert.deepEqual(store.load(), { platform: 'instagram', idleBehavior: 'pause' });
    store.save({ platform: 'tiktok', idleBehavior: 'close' });
    assert.deepEqual(new SettingsStore(root).load(), { platform: 'tiktok', idleBehavior: 'close' });
    fs.mkdirSync(store.file + '.tmp');
    assert.throws(() => store.save({ platform: 'youtube', idleBehavior: 'pause' }));
    assert.equal(store.load().platform, 'tiktok');
    fs.rmdirSync(store.file + '.tmp');
    fs.writeFileSync(store.file, '{"platform":"invalid","idleBehavior":"close"}');
    assert.deepEqual(store.load(), { platform: 'instagram', idleBehavior: 'close' });
    fs.writeFileSync(store.file, '{broken');
    assert.deepEqual(store.load(), { platform: 'instagram', idleBehavior: 'pause' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('API controls, payload validation, same-origin protection, static assets, and singleton port', async () => {
  const { controller: c } = fixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-api-'));
  fs.mkdirSync(path.join(root, 'dist')); fs.writeFileSync(path.join(root, 'dist/index.html'), '<h1>Dashboard</h1>');
  let quit = false;
  const server = createControlServer({ controller: c, root, shutdown: async () => { quit = true; await c.shutdown(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const request = (route, method = 'POST', body = {}, headers = {}) => fetch(url + '/api/' + route, {
    method, headers: { 'Content-Type': 'application/json', Origin: url, ...headers }, body: JSON.stringify(body),
  });
  try {
    assert.match(await (await fetch(url)).text(), /Dashboard/);
    assert.equal((await (await fetch(url + '/api/status')).json()).enabled, false);
    assert.equal((await request('start')).status, 200); assert.equal(c.enabled, true);
    assert.equal((await request('stop')).status, 200); assert.equal(c.enabled, false);
    assert.equal((await request('settings', 'PATCH', { platform: 'youtube' })).status, 200);
    assert.equal((await request('settings', 'PATCH', { platform: 'bogus' })).status, 400);
    assert.equal((await request('settings', 'PATCH', { toString: 'invalid' })).status, 400);
    assert.equal((await request('auto-scroll', 'PUT', { enabled: false })).status, 200);
    assert.equal(c.autoScroll, false);
    assert.equal((await request('auto-scroll', 'PUT', { enabled: 'yes' })).status, 400);
    assert.equal((await request('start', 'POST', {}, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await request('start', 'POST', {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await request('start', 'POST', { bogus: true })).status, 400);
    const duplicate = http.createServer();
    const error = await new Promise(resolve => { duplicate.once('error', resolve); duplicate.listen(server.address().port, '127.0.0.1'); });
    assert.equal(error.code, 'EADDRINUSE');
    assert.equal((await request('shutdown')).status, 200); assert.equal(quit, true);
  } finally {
    await c.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('platform guards allow feed routes and reject login, dialogs, inputs, and offscreen video', () => {
  for (const [platform, adapter] of Object.entries(platforms)) {
    const location = new URL(adapter.url);
    const document = {
      activeElement: null,
      querySelectorAll: selector => selector === 'video' ? [{ currentSrc: 'blob:loaded-video', readyState: 4, getBoundingClientRect: () => ({ width: 200, height: 300, top: 0, bottom: 300, left: 0, right: 200 }) }] : [],
    };
    const run = () => vm.runInNewContext(scrollGuard(platform), { document, location, URL, innerHeight: 700, innerWidth: 400 });
    assert.equal(run(), true, platform);
    document.activeElement = { tagName: 'INPUT' }; assert.equal(run(), false);
    document.activeElement = null; location.pathname = '/login'; assert.equal(run(), false);
    location.pathname = new URL(adapter.url).pathname;
    const original = document.querySelectorAll;
    document.querySelectorAll = selector => selector === 'video' ? original(selector) : [{ getClientRects: () => [1] }];
    assert.equal(run(), false);
    document.querySelectorAll = original;
    location.hostname = 'example.com'; assert.equal(run(), false);
    location.hostname = new URL(adapter.url).hostname;
    document.querySelectorAll = selector => selector === 'video' ? [{ currentSrc: 'blob:loaded', readyState: 4, getBoundingClientRect: () => ({width:200,height:300,top:900,bottom:1200,left:0,right:200}) }] : [];
    assert.equal(run(), false);
    document.querySelectorAll = selector => selector === 'video' ? [{ ...original(selector)[0], readyState: 0 }] : [];
    assert.equal(run(), false);
  }
});


test('reconnect does not restore a viewer manually closed during the same task', async () => {
  const { controller: c, calls } = fixture();
  try {
    c.activity(1, {}); await c.start(); const opened = calls.open;
    c.connection(false); c.connection(true); await c.queue;
    assert.equal(calls.open, opened);
    c.activity(0, {}); c.activity(1, {}); await c.queue;
    assert.equal(calls.open, opened + 1);
  } finally { await c.shutdown(); }
});
test('a queued idle close is cancelled by Open/Login', async () => {
  const { controller: c, calls } = fixture('close');
  try {
    c.activity(1, {}); await c.start();
    let release;
    c.background(() => new Promise(resolve => { release = resolve; }));
    await delay(0); c.activity(0, {}); await delay(25);
    const open = c.openManually(); release(); await open;
    assert.equal(calls.close, 0);
  } finally { await c.shutdown(); }
});
test('Stop cancels a pending scroll before CDP keyboard dispatch', async () => {
  const { Viewer } = await import('../src/viewer.js');
  let release, keys = 0, allowed = true;
  const page = { alive: true, send: async (method) => {
    if (method === 'Runtime.evaluate') return new Promise(resolve => { release = () => resolve({ result: { value: true } }); });
    keys++;
  } };
  const viewer = new Viewer({ platform: 'youtube' }, '', () => {});
  viewer.windows = [{ page }];
  const scrolling = viewer.scroll(() => allowed);
  allowed = false; release(); await scrolling;
  assert.equal(keys, 0);
});
