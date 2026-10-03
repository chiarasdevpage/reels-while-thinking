// Opt-in integration test: starts an isolated local server and runs a real Ollama task.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root, loadConfig } from '../src/config.js';
import { Viewer } from '../src/viewer.js';
import { Controller } from '../src/controller.js';
import { Detector } from '../src/detector.js';

const work = path.join(root, 'runtime', 'opencode-smoke');
fs.mkdirSync(work, { recursive: true });
const executable = process.env.OPENCODE_TEST_EXE || path.join(process.env.APPDATA, 'npm/node_modules/opencode-ai/bin/opencode.exe');
const url = 'http://127.0.0.1:4196';
const provider = {
  provider: { ollama: { npm: '@ai-sdk/openai-compatible', name: 'Local Ollama', options: { baseURL: 'http://127.0.0.1:11434/v1' },
    models: { 'qwen3:4b': { name: 'Qwen3 4B', limit: { context: 8192, output: 64 } } } } },
  agent: { smoke: { mode: 'primary', prompt: 'Reply OK. Do not use tools.', tools: { '*': false } } },
  model: 'ollama/qwen3:4b', small_model: 'ollama/qwen3:4b',
};
const child = spawn(executable, ['serve', '--pure', '--hostname', '127.0.0.1', '--port', '4196'], {
  cwd: work, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(provider) },
});
child.stdout.on('data', data => process.stdout.write(data));
child.stderr.on('data', data => process.stderr.write(data));
const pageServer = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>Live OpenCode test</title><h1>A real local model is thinking</h1><video style="width:240px;height:320px"></video><script>window.advances=0;addEventListener("keydown",e=>{if(e.key==="ArrowDown")window.advances++})</script>'); });
await new Promise(resolve => pageServer.listen(0, '127.0.0.1', resolve));
const config = { ...loadConfig(), popouts: 1, autoClose: true, autoCloseDelayMs: 100, autoScroll: true, autoScrollIntervalMs: 1000, targetUrl: `http://127.0.0.1:${pageServer.address().port}/` };
const events = [];
const log = (event, fields) => { events.push({ event, ...fields }); console.log(event, fields || ''); };
const viewer = new Viewer(config, work, log);
const controller = new Controller(config, viewer, log);
const detector = new Detector({ ...config.opencode, url, directory: work }, controller, log);
let running; let sessionID;
const headers = { 'Content-Type': 'application/json' };
if (process.env.OPENCODE_SERVER_PASSWORD) headers.Authorization = `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME || 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
async function request(route, method = 'GET', body) {
  const res = await fetch(`${url}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${route}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
async function until(predicate, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await delay(100); }
  throw new Error('Integration test timed out');
}
try {
  let healthError;
  await until(async () => {
    try { await request('/global/health'); return true; }
    catch (error) {
      if (error.message !== healthError) { healthError = error.message; console.log('Waiting for test server:', healthError); }
      return false;
    }
  }, 30000);
  running = detector.run();
  await until(() => controller.connected);
  const session = await request('/session', 'POST', { title: 'Reels utility local integration test', permission: [{ permission: '*', pattern: '*', action: 'deny' }] });
  sessionID = session.id;
  await request(`/session/${sessionID}/prompt_async`, 'POST', {
    model: { providerID: 'ollama', modelID: 'qwen3:4b' }, agent: 'smoke',
    parts: [{ type: 'text', text: 'Reply OK. /no_think' }],
  });
  await until(() => events.some(e => e.event === 'task.start'));
  await until(() => events.some(e => e.event === 'task.finish'), 180000);
  await until(() => events.some(e => e.event === 'popouts.closed'));
  const messages = await request(`/session/${sessionID}/message`);
  const assistant = messages.filter(m => m.info.role === 'assistant');
  assert.ok(assistant.length, 'Model must produce an assistant message');
  assert.ok(assistant.every(m => !m.info.error), `Generation failed: ${JSON.stringify(assistant.map(m => m.info.error))}`);
  console.log('Model output:', assistant.map(m => ({ finish: m.info.finish, tokens: m.info.tokens, partTypes: m.parts.map(p => p.type) })));
  assert.ok(assistant.some(m => m.parts.some(p => ['text', 'reasoning'].includes(p.type) && p.text?.trim())), 'Model must produce text or reasoning');
  assert.equal(events.filter(e => e.event === 'task.start').length, 1);
  assert.equal(events.filter(e => e.event === 'popout.open').length, 1);
  console.log('PASS: real OpenCode + local Ollama generation -> one controlled popout -> idle -> auto-close');
  fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), events }, null, 2));
} finally {
  detector.stop(); await running;
  await controller.stop();
  if (sessionID) {
    await request(`/session/${sessionID}/abort`, 'POST').catch(() => {});
    await request(`/session/${sessionID}`, 'DELETE').catch(() => {});
  }
  child.kill();
  pageServer.closeAllConnections(); await new Promise(resolve => pageServer.close(resolve));
}
