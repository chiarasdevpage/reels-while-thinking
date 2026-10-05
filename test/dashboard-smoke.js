// Real browser test of the built React UI; automation uses a fake viewer.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { root, loadConfig } from '../src/config.js';
import { Viewer } from '../src/viewer.js';
import { Controller } from '../src/controller.js';
import { SettingsStore } from '../src/settings.js';
import { createControlServer } from '../src/server.js';

const work = path.join(root, 'runtime', 'dashboard-smoke');
const store = new SettingsStore(work);
const calls = { open: 0, close: 0, scroll: 0 };
const config = { ...loadConfig(), platform: 'instagram', idleBehavior: 'pause', autoScrollIntervalMs: 50 };
const controller = new Controller(config, { ensure: async () => calls.open++, close: async () => calls.close++, scroll: async () => calls.scroll++ }, () => {}, store);
controller.connection(true);
const server = createControlServer({ controller, root, shutdown: () => controller.shutdown() });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const viewer = new Viewer({ ...loadConfig(), popouts: 1, width: 920, height: 1000, targetUrl: url }, work, () => {});
let page;
const evaluate = async expression => {
  const response = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result?.value;
};
async function until(expression) {
  for (let i = 0; i < 100; i++) { if (await evaluate('Boolean(document.body) && (' + expression + ')')) return; await delay(100); }
  throw new Error('UI timed out: ' + expression);
}
const ready = () => until("document.querySelector('button.primary') && !document.body.textContent.includes('Applying your changes')");
async function click(label) {
  const selector = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(label)}))`;
  await until(`${selector} && !${selector}.disabled`);
  await evaluate(`${selector}.click()`);
  await delay(100); await ready();
}
async function select(label, value) {
  const selector = `document.querySelector('select[aria-label="${label}"]')`;
  await until(`${selector} && !${selector}.disabled`);
  await evaluate(`(() => { const el = ${selector}; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await delay(100); await ready();
}
try {
  await viewer.ensure(); page = viewer.windows[0].page;
  await until("document.body.textContent.includes('Ready when you are')");
  assert.equal(controller.enabled, false);
  const capture = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(work, 'dashboard.png'), Buffer.from(capture.data, 'base64'));
  await click('Start');
  assert.equal(controller.enabled, true); assert.equal(calls.open, 1);
  assert.equal(await evaluate("document.querySelector('select[aria-label=Platform]').disabled"), true);
  controller.activity(1, {});
  await until("document.querySelector('.badge').textContent.includes('Running')");
  await evaluate("document.querySelector('input[role=switch]').click()");
  await delay(150); await ready(); assert.equal(controller.autoScroll, false);
  await click('Stop'); assert.equal(controller.enabled, false); assert.equal(calls.close, 0);
  await select('Platform', 'youtube'); assert.equal(controller.settings.platform, 'youtube');
  await select('When idle or stopped', 'close'); assert.equal(store.load().idleBehavior, 'close');
  await click('Open / Login'); assert.ok(calls.open >= 2);
  await click('Start'); await click('Stop'); assert.ok(calls.close >= 2);
  await page.send('Page.reload'); await until("document.body.textContent.includes('Ready when you are')");
  assert.equal(await evaluate("document.querySelector('select[aria-label=Platform]').value"), 'youtube');
  controller.connection(false); await until("document.body.textContent.includes('Disconnected')");
  controller.connection(true); await until("document.body.textContent.includes('Typing')");
  await click('Quit watcher'); await until("document.body.textContent.includes('Watcher stopped.')");
  assert.equal(controller.stopped, true);
  console.log('PASS: React dashboard rendered; Start, Stop, both selectors, auto-scroll, Open/Login, Quit, reload, and detector connection status');
} finally {
  await controller.shutdown(); await viewer.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
