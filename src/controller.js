export class Controller {
  constructor(config, viewer, log) {
    this.config = config; this.viewer = viewer; this.log = log;
    this.count = 0; this.connected = false; this.stopped = false;
    this.autoScroll = config.autoScroll; this.queue = Promise.resolve();
  }
  enqueue(action) {
    this.queue = this.queue.then(action).catch(error => this.log('viewer.error', { message: error.message }));
    return this.queue;
  }
  connection(connected) {
    this.connected = connected;
    this.refreshScroll();
  }
  activity(count, trigger) {
    if (this.stopped) return;
    const previous = this.count;
    this.count = count;
    if (count > 0) {
      clearTimeout(this.closeTimer);
      if (!previous) {
        this.log('task.start', { activeSessions: count, ...trigger });
        this.enqueue(async () => { if (!this.stopped) await this.viewer.ensure(); this.refreshScroll(); });
      }
    } else if (previous) {
      this.log('task.finish', trigger);
      if (this.config.autoClose) this.closeTimer = setTimeout(() => {
        this.enqueue(async () => { if (!this.count) await this.viewer.close(); });
      }, this.config.autoCloseDelayMs);
    }
    this.refreshScroll();
  }
  refreshScroll() {
    clearInterval(this.scrollTimer);
    if (this.stopped || !this.connected || !this.count || !this.autoScroll) return;
    this.scrollTimer = setInterval(() => {
      if (this.scrolling) return;
      this.scrolling = true;
      this.enqueue(async () => {
        try {
          const allowed = () => !this.stopped && this.connected && this.count > 0 && this.autoScroll;
          if (allowed()) await this.viewer.scroll(allowed);
        }
        finally { this.scrolling = false; }
      });
    }, this.config.autoScrollIntervalMs);
  }
  toggleScroll() {
    this.autoScroll = !this.autoScroll;
    this.log('scroll.mode', { enabled: this.autoScroll });
    this.refreshScroll();
  }
  openManually() { return this.enqueue(() => this.viewer.ensure()); }
  async stop() {
    this.stopped = true;
    clearTimeout(this.closeTimer); clearInterval(this.scrollTimer);
    await this.enqueue(() => this.viewer.close());
  }
}
