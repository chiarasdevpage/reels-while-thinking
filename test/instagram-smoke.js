// Optional public-feed navigation check. Does not sign in or interact with an account.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { root, loadConfig } from '../src/config.js';
import { Viewer } from '../src/viewer.js';

const work = path.join(root, 'runtime', 'instagram-smoke');
const viewer = new Viewer({ ...loadConfig(), popouts: 1 }, work, console.log);
try {
  await viewer.ensure();
  const page = viewer.windows[0].page;
  await delay(8000);
  const { result } = await page.send('Runtime.evaluate', {
    expression: '({url:location.href,title:document.title,ready:document.readyState})', returnByValue: true,
  });
  assert.equal(new URL(result.value.url).hostname, 'www.instagram.com');
  assert.equal(result.value.ready, 'complete');
  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(work, 'instagram.png'), Buffer.from(screenshot.data, 'base64'));
  console.log('Instagram navigation:', result.value);
  await viewer.scroll();
  await delay(2000);
  const after = await page.send('Runtime.evaluate', {
    expression: 'location.href', returnByValue: true,
  });
  assert.ok(new URL(after.result.value).pathname.startsWith('/reels/'));
  assert.notEqual(after.result.value, result.value.url, 'ArrowDown must navigate to another Reel');
  fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), before: result.value.url, after: after.result.value }, null, 2));
  console.log('PASS: dedicated Instagram viewer rendered a public Reel and advanced to another Reel');
} finally { await viewer.close(); }
