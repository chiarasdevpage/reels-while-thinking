// Public platform check in separate test profiles. Never logs in or bypasses dialogs.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root, loadConfig } from '../src/config.js';
import { Viewer } from '../src/viewer.js';
import { platforms, scrollGuard } from '../src/platforms.js';

const results = [];
for (const [platform, adapter] of Object.entries(platforms)) {
  const work = path.join(root, 'runtime', 'platform-smoke', platform);
  const viewer = new Viewer({ ...loadConfig(), popouts: 1, platform, targetUrl: adapter.url }, work, () => {});
  const item = { platform, passed: false };
  try {
    await viewer.ensure();
    const page = viewer.windows[0].page;
    const evaluate = async expression => (await page.send('Runtime.evaluate', { expression, returnByValue: true })).result?.value;
    for (let i = 0; i < 15; i++) {
      await delay(1000);
      if (await evaluate(scrollGuard(platform))) break;
    }
    const snapshot = `(() => { const v = Array.from(document.querySelectorAll('video')).find(v=>{const r=v.getBoundingClientRect();return r.height>0&&r.bottom>0&&r.top<innerHeight});return {url:location.href,title:document.title,video:v?.currentSrc||null,text:document.body.innerText.slice(0,600)};})()`;
    item.before = await evaluate(snapshot);
    item.eligible = await evaluate(scrollGuard(platform));
    if (item.eligible) {
      await viewer.scroll(); await delay(2500);
      item.after = await evaluate(snapshot);
      item.passed = Boolean(item.before.url !== item.after.url || (item.before.video && item.after.video && item.before.video !== item.after.video));
      if (!item.passed) item.blocker = 'A video was visible, but one ArrowDown did not demonstrate advancement.';
    } else item.blocker = 'No eligible visible video; inspect the screenshot for login, consent, network, or availability restrictions.';
    const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(work, 'page.png'), Buffer.from(screenshot.data, 'base64'));
  } catch (error) { item.blocker = error.message; }
  finally { await viewer.close(); }
  results.push(item); console.log(platform + ': ' + (item.passed ? 'PASS: video advanced' : 'BLOCKED: ' + item.blocker));
}
fs.mkdirSync(path.join(root, 'runtime', 'platform-smoke'), { recursive: true });
fs.writeFileSync(path.join(root, 'runtime', 'platform-smoke', 'result.json'), JSON.stringify(results, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
