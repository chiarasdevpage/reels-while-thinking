// Deliberately opens visible test windows. Uses local HTML, never your Instagram profile.
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig, root } from '../src/config.js';
import { Viewer } from '../src/viewer.js';

const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>Reels utility smoke test</title><h1>Local test</h1><video style="width:240px;height:320px"></video><input id="login"><script>window.advances=0;document.addEventListener("keydown",e=>{if(e.key==="ArrowDown")window.advances++})</script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const config = { ...loadConfig(), popouts: 3, targetUrl: `http://127.0.0.1:${server.address().port}/`, width: 360, height: 640 };
const viewer = new Viewer(config, path.join(root, 'runtime', 'browser-smoke'), (event, fields) => console.log(event, fields || ''));
try {
  await viewer.ensure();
  assert.equal(viewer.windows.length, 3);
  const original = [...viewer.windows];
  await viewer.ensure();
  assert.deepEqual(viewer.windows, original);
  await delay(1000);
  const evaluate = async (window, expression) => (await window.page.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  await viewer.scroll();
  for (const window of viewer.windows) assert.equal(await evaluate(window, 'window.advances'), 1);
  await evaluate(viewer.windows[0], 'document.querySelector("input").focus()');
  await viewer.scroll();
  assert.equal(await evaluate(viewer.windows[0], 'window.advances'), 1, 'Focused input must suppress scrolling');
  assert.equal(await evaluate(viewer.windows[1], 'window.advances'), 2);
  const { windowId, bounds } = await viewer.windows[0].browser.send('Browser.getWindowForTarget', { targetId: viewer.windows[0].targetId });
  assert.equal(bounds.width, 360); assert.equal(bounds.height, 640);
  assert.equal(bounds.left, config.left); assert.equal(bounds.top, config.top);
  assert.ok(windowId);
  console.log('PASS: three dedicated windows, reuse, dimensions, position, targeted scrolling, input guard');
} finally {
  await viewer.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
