import { platforms } from './platforms.js';
import { validateSettings } from './settings.js';

export class Controller {
  constructor(config, viewer, log, settingsStore) {
    this.config = config; this.viewer = viewer; this.log = log; this.settingsStore = settingsStore;
    this.settings = { platform: config.platform || 'instagram', idleBehavior: config.idleBehavior || (config.autoClose ? 'close' : 'pause') };
    this.count = 0; this.connected = false; this.stopped = false; this.enabled = false; this.needsOpen = false;
    this.autoScroll = true; this.queue = Promise.resolve(); this.pending = 0; this.error = null; this.generation = 0; this.closeRevision = 0;
  }
  status() {
    const eligible = this.allowed();
    return {
      connected: this.connected, activity: !this.connected ? 'disconnected' : this.count ? 'typing' : 'idle',
      enabled: this.enabled, automation: eligible ? 'running' : 'paused',
      scrollingEligible: eligible, autoScroll: this.autoScroll, settings: { ...this.settings },
      pending: this.pending > 0, error: this.error, shutdown: this.stopped,
    };
  }
  enqueue(action) {
    this.pending++;
    const result = this.queue.then(action).catch(error => {
      this.error = error.message; this.log('viewer.error', { message: error.message }); throw error;
    }).finally(() => { this.pending--; });
    this.queue = result.catch(() => {});
    return result;
  }
  background(action) { void this.enqueue(action).catch(() => {}); }
  assertLive() { if (this.stopped) throw new Error('Watcher is shutting down'); }
  allowed() { return !this.stopped && this.enabled && this.connected && this.count > 0 && this.autoScroll; }
  cancelClose() { this.closeRevision++; clearTimeout(this.closeTimer); this.closeTimer = undefined; }
  connection(connected) {
    this.connected = connected;
    if (!connected) this.cancelClose();
    else if (this.enabled) {
      if (this.count) { if (this.needsOpen) this.ensureActive(); }
      else this.applyIdle();
    }
    this.refreshScroll();
  }
  activity(count, trigger) {
    if (this.stopped) return;
    const previous = this.count;
    this.count = count;
    if (count > 0) {
      this.cancelClose();
      if (!previous) {
        this.needsOpen = true;
        this.log('task.start', { activeSessions: count, ...trigger });
        if (this.enabled && this.connected) this.ensureActive();
      }
    } else if (previous) {
      this.log('task.finish', trigger);
      this.applyIdle();
    }
    this.refreshScroll();
  }
  ensureActive() {
    const generation = this.generation;
    this.background(async () => {
      if (generation !== this.generation || !this.enabled || !this.connected || !this.count || this.stopped) return;
      await this.viewer.ensure();
      this.needsOpen = false;
      this.refreshScroll();
    });
  }
  applyIdle() {
    this.cancelClose();
    if (this.stopped || !this.enabled || !this.connected || this.count || this.settings.idleBehavior !== 'close') return;
    const revision = this.closeRevision;
    this.closeTimer = setTimeout(() => {
      this.background(async () => {
        if (revision === this.closeRevision && !this.stopped && this.enabled && this.connected && !this.count && this.settings.idleBehavior === 'close') await this.viewer.close();
      });
    }, this.config.autoCloseDelayMs);
  }
  refreshScroll() {
    clearInterval(this.scrollTimer);
    if (!this.allowed()) return;
    this.scrollTimer = setInterval(() => {
      if (this.scrolling) return;
      this.scrolling = true;
      const generation = this.generation;
      this.background(async () => {
        try {
          const allowed = () => generation === this.generation && this.allowed();
          if (allowed()) await this.viewer.scroll(allowed);
        } finally { this.scrolling = false; }
      });
    }, this.config.autoScrollIntervalMs);
  }
  start() {
    this.assertLive(); this.error = null;
    this.enabled = true; this.cancelClose();
    const generation = this.generation;
    return this.enqueue(async () => {
      if (generation !== this.generation || !this.enabled || this.stopped) return;
      await this.viewer.ensure();
      this.needsOpen = false;
      this.refreshScroll();
      this.applyIdle();
    });
  }
  stop() {
    this.assertLive(); this.error = null;
    this.enabled = false; this.generation++;
    this.cancelClose(); this.refreshScroll();
    const close = this.settings.idleBehavior === 'close';
    return this.enqueue(async () => { if (close) await this.viewer.close(); });
  }
  setAutoScroll(enabled) {
    this.assertLive();
    if (typeof enabled !== 'boolean') throw new Error('Auto-scroll must be true or false');
    this.autoScroll = enabled;
    this.log('scroll.mode', { enabled }); this.refreshScroll();
  }
  toggleScroll() { this.setAutoScroll(!this.autoScroll); }
  openManually() {
    this.assertLive(); this.error = null; this.cancelClose();
    const generation = this.generation;
    return this.enqueue(async () => { if (generation === this.generation && !this.stopped) { this.cancelClose(); await this.viewer.ensure(); } });
  }
  updateSettings(patch) {
    this.assertLive(); validateSettings(patch, true);
    return this.enqueue(async () => {
      this.assertLive();
      const next = { ...this.settings, ...patch };
      const changedPlatform = next.platform !== this.settings.platform;
      if (changedPlatform && this.enabled) throw new Error('Stop automation before changing platforms');
      if (changedPlatform) await this.viewer.close();
      this.settingsStore?.save(next);
      this.settings = next;
      this.config.platform = next.platform;
      this.config.targetUrl = platforms[next.platform].url;
      this.config.idleBehavior = next.idleBehavior;
      this.error = null;
      this.applyIdle();
    });
  }
  async shutdown() {
    if (this.stopped) return this.queue;
    this.stopped = true; this.enabled = false; this.generation++;
    this.cancelClose(); this.refreshScroll();
    await this.enqueue(() => this.viewer.close());
  }
}
