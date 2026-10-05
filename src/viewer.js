import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { CDP } from './cdp.js';
import { platforms, scrollGuard, advanceKeys } from './platforms.js';

export function findBrowser(configured) {
  if (configured) {
    if (!fs.existsSync(configured)) throw new Error(`Browser not found: ${configured}`);
    return configured;
  }
  const candidates = [
    ['PROGRAMFILES(X86)', 'Microsoft/Edge/Application/msedge.exe'],
    ['PROGRAMFILES', 'Microsoft/Edge/Application/msedge.exe'],
    ['PROGRAMFILES', 'Google/Chrome/Application/chrome.exe'],
    ['LOCALAPPDATA', 'Microsoft/Edge/Application/msedge.exe'],
    ['LOCALAPPDATA', 'Google/Chrome/Application/chrome.exe'],
  ];
  for (const [env, suffix] of candidates) {
    const file = path.join(process.env[env] || '', suffix);
    if (fs.existsSync(file)) return file;
  }
  throw new Error('Edge/Chrome not found. Set browserPath in config.json.');
}

export class Viewer {
  constructor(config, root, log) { this.config = config; this.root = root; this.log = log; this.windows = []; }
  async ensure() {
    for (let i = 0; i < this.config.popouts; i++) {
      if (this.windows[i]?.page.alive) continue;
      if (this.windows[i]) await this.closeOne(this.windows[i]);
      this.windows[i] = await this.open(i);
    }
  }
  async open(index) {
    const c = this.config;
    const profile = path.join(this.root, 'runtime', `profile-${index + 1}`);
    fs.mkdirSync(profile, { recursive: true });
    const portFile = path.join(profile, 'DevToolsActivePort');
    // Reattach to our own dedicated profile after an unclean utility exit.
    let connection = await this.attach(portFile);
    let child;
    let launchError;
    if (!connection) {
      fs.rmSync(portFile, { force: true });
      child = spawn(findBrowser(c.browserPath), [
        `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
        '--no-first-run', '--no-default-browser-check', '--disable-background-mode',
        `--app=${c.targetUrl}`, `--window-size=${c.width},${c.height}`,
        `--window-position=${c.left + index * (c.width + c.gap)},${c.top}`,
      ], { stdio: 'ignore', windowsHide: false });
      child.on('error', error => { launchError = error; });
      for (let tries = 0; tries < 80 && !connection; tries++) {
        if (launchError) throw launchError;
        await delay(250);
        connection = await this.attach(portFile);
      }
      if (!connection) { child.kill(); throw new Error('Browser did not expose its control endpoint within 20 seconds'); }
    }
    const { browser, page, targetId } = connection;
    try {
      if (!child && c.platform) {
        const { result } = await page.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
        const current = new URL(result.value);
        const adapter = platforms[c.platform];
        if (current.origin !== new URL(adapter.url).origin || !new RegExp(adapter.routes).test(current.pathname))
          await page.send('Page.navigate', { url: adapter.url });
      }
      const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId });
      await browser.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await browser.send('Browser.setWindowBounds', { windowId, bounds: {
        width: c.width, height: c.height, left: c.left + index * (c.width + c.gap), top: c.top,
      } });
      this.log('popout.open', { window: index + 1, reused: !child });
      return { browser, page, child, targetId };
    } catch (error) { await this.closeOne({ browser, page, child }); throw error; }
  }
  async attach(portFile) {
    let browser;
    try {
      const [port, socketPath] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
      if (!/^\d+$/.test(port) || !socketPath?.startsWith('/devtools/browser/')) return null;
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
      const target = (await response.json()).find(t => t.type === 'page' && !t.url.startsWith('edge://'));
      if (!target) return null;
      browser = await CDP.connect(`ws://127.0.0.1:${port}${socketPath}`);
      const page = await CDP.connect(target.webSocketDebuggerUrl);
      return { browser, page, targetId: target.id };
    } catch { browser?.close(); return null; }
  }
  async scroll(allowed = () => true) {
    for (const [index, window] of this.windows.entries()) {
      if (!allowed()) return;
      if (!window?.page.alive) continue;
      try {
        const { result } = await window.page.send('Runtime.evaluate', { expression: scrollGuard(this.config.platform, this.config.targetUrl), returnByValue: true });
        if (!result?.value) { this.log('scroll.skipped', { window: index + 1, reason: 'No eligible visible video, a dialog, or an active input' }); continue; }
        if (!allowed()) return;
        for (const key of advanceKeys) await window.page.send('Input.dispatchKeyEvent', key);
        this.log('scroll.advance', { window: index + 1 });
      } catch (error) { this.log('scroll.error', { window: index + 1, message: error.message }); throw error; }
    }
  }
  async closeOne(window) {
    try { await window.browser.send('Browser.close'); } catch { window.child?.kill(); }
    window.page.close(); window.browser.close();
  }
  async close() {
    for (const window of this.windows) if (window) await this.closeOne(window);
    this.windows = [];
    this.log('popouts.closed');
  }
}
