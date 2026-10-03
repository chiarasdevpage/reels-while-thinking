import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Controller } from '../src/controller.js';
import { TaskState, sse, Detector } from '../src/detector.js';
import { loadConfig, validateConfig } from '../src/config.js';
import http from 'node:http';

const noop = () => {};
function fixture(overrides = {}) {
  const calls = { open: 0, close: 0, scroll: 0 };
  const viewer = { ensure: async () => calls.open++, close: async () => calls.close++, scroll: async () => calls.scroll++ };
  const controller = new Controller({ autoScroll: false, autoClose: true, autoCloseDelayMs: 20, autoScrollIntervalMs: 10, ...overrides }, viewer, noop);
  const state = new TaskState((count, trigger) => controller.activity(count, trigger), noop);
  const event = (id, status, directory = 'C:/project') => state.event(directory, { type: 'session.status', properties: { sessionID: id, status: { type: status } } });
  return { calls, controller, state, event };
}

test('repeated busy/retry and concurrent tasks use a single group of windows', async () => {
  const f = fixture();
  f.event('one', 'busy'); f.event('one', 'busy'); f.event('one', 'retry'); f.event('two', 'busy');
  await f.controller.queue;
  assert.equal(f.calls.open, 1);
  f.event('one', 'idle'); await delay(35);
  assert.equal(f.calls.close, 0);
  f.event('two', 'idle'); await delay(35);
  assert.equal(f.calls.close, 1);
  await f.controller.stop();
});

test('new task cancels delayed close; next task can reuse remaining windows', async () => {
  const f = fixture();
  f.event('one', 'busy'); f.event('one', 'idle'); f.event('two', 'busy');
  await delay(35);
  assert.equal(f.calls.close, 0);
  assert.equal(f.calls.open, 2);
  await f.controller.stop();
});

test('scrolling runs only while connected, active, and enabled', async () => {
  const f = fixture({ autoScroll: true, autoClose: false });
  f.controller.connection(true); f.event('one', 'busy');
  await delay(45); assert.ok(f.calls.scroll > 0);
  f.controller.connection(false); await f.controller.queue;
  let count = f.calls.scroll; await delay(30); assert.equal(f.calls.scroll, count);
  f.controller.connection(true); f.controller.toggleScroll();
  await delay(30); assert.equal(f.calls.scroll, count);
  f.controller.toggleScroll(); f.event('one', 'idle');
  await delay(30); assert.equal(f.calls.scroll, count);
  assert.equal(f.calls.close, 0);
  await f.controller.stop();
});

test('late browser launch after task end never starts scrolling and is closed', async () => {
  const f = fixture({ autoScroll: true });
  f.controller.viewer.ensure = async () => { await delay(40); f.calls.open++; };
  f.controller.connection(true); f.event('one', 'busy'); f.event('one', 'idle');
  await delay(80);
  assert.deepEqual(f.calls, { open: 1, close: 1, scroll: 0 });
  await f.controller.stop();
});

test('reconciliation repairs missed idle but cannot overwrite a newer live event', async () => {
  const f = fixture();
  f.event('one', 'busy');
  f.state.snapshot('C:/project', {}, 0);
  assert.equal(f.state.active.size, 1);
  f.state.snapshot('C:/project', {}, 1);
  assert.equal(f.state.active.size, 0);
  await f.controller.stop();
});

test('same session identifiers in different directories stay independent', async () => {
  const f = fixture();
  f.event('one', 'busy', 'A'); f.event('one', 'busy', 'B'); f.event('one', 'idle', 'A');
  assert.equal(f.state.active.size, 1);
  await f.controller.stop();
});

test('a snapshot replacing one busy session with another has no false idle transition', async () => {
  const f = fixture();
  f.event('one', 'busy');
  await f.controller.queue;
  f.state.snapshot('C:/project', { one: { type: 'idle' }, two: { type: 'busy' } }, 1);
  await f.controller.queue;
  assert.equal(f.calls.open, 1);
  assert.equal(f.controller.count, 1);
  await f.controller.stop();
});

test('SSE parses fragmented CRLF, comments, unicode, and multiple data lines', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\ndata: {"name":\r\ndata: "🎬"}\r\n\r\ndata: {"ok":true}\n\n');
  async function* chunks() { for (const b of bytes) yield Uint8Array.of(b); }
  const events = [];
  for await (const value of sse(chunks())) events.push(JSON.parse(value));
  assert.deepEqual(events, [{ name: '🎬' }, { ok: true }]);
});

test('configuration rejects unsafe origins, invalid counts and timer values', () => {
  const c = loadConfig(); assert.equal(c.popouts, 1);
  for (const patch of [{ popouts: 0 }, { popouts: 4 }, { autoScroll: 'false' }, { autoScrollIntervalMs: 0 }, { targetUrl: 'file:///C:/' }])
    assert.throws(() => validateConfig({ ...c, ...patch }));
  assert.throws(() => validateConfig({ ...c, opencode: { ...c.opencode, url: 'http://example.com' } }));
});

test('real HTTP SSE disconnect/reconnect reconciles a missed finish without spawning again', async () => {
  const f = fixture({ autoCloseDelayMs: 5 });
  let stream; let statuses = {}; let streams = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/path') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ directory: 'C:/project' })); }
    else if (url.pathname === '/session/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(statuses)); }
    else if (url.pathname === '/global/event') {
      streams++; stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"payload":{"type":"server.connected"}}\n\n');
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const detector = new Detector({ url: `http://127.0.0.1:${server.address().port}`, directory: '', reconnectMs: 10, reconcileMs: 1000 }, f.controller, noop);
  const running = detector.run();
  const until = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(10); } assert.fail('Timed out'); };
  try {
    await until(() => f.controller.connected);
    statuses = { one: { type: 'busy' } };
    stream.write(`data: ${JSON.stringify({ directory: 'C:/project', payload: { type: 'session.status', properties: { sessionID: 'one', status: { type: 'busy' } } } })}\n\n`);
    await until(() => f.calls.open === 1);
    statuses = {}; stream.end();
    await until(() => streams >= 2 && f.calls.close === 1);
    assert.equal(f.calls.open, 1);
  } finally {
    detector.stop(); await running; await f.controller.stop();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
