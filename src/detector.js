import { setTimeout as delay } from 'node:timers/promises';

// Handles arbitrary chunk boundaries, multi-line data fields, CRLF, and SSE comments.
export async function* sse(body) {
  const decoder = new TextDecoder();
  let buffer = ''; let data = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 4 * 1024 * 1024) throw new Error('Oversized SSE frame');
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (!line) {
        if (data.length) { yield data.join('\n'); data = []; }
      } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
  }
}

export class TaskState {
  constructor(onChange, log) { this.active = new Map(); this.revisions = new Map(); this.onChange = onChange; this.log = log; }
  key(directory, id) { return JSON.stringify([directory, id]); }
  set(directory, id, type, source) {
    if (!id || !['busy', 'retry', 'idle'].includes(type)) return;
    const key = this.key(directory, id);
    const before = this.active.size;
    const wasActive = this.active.has(key);
    if (type === 'idle') this.active.delete(key);
    else this.active.set(key, { directory, id });
    if (wasActive !== this.active.has(key)) this.log('opencode.status', { source, directory, sessionID: id, status: type });
    if (!this.batching && this.active.size !== before) this.onChange(this.active.size, { source, directory, sessionID: id, status: type });
  }
  event(directory, event) {
    const p = event.properties || {};
    let id; let type;
    if (event.type === 'session.status') { id = p.sessionID; type = p.status?.type; }
    else if (event.type === 'session.idle') { id = p.sessionID; type = 'idle'; }
    else if (event.type === 'session.deleted') { id = p.info?.id; type = 'idle'; }
    else return;
    this.revisions.set(directory, (this.revisions.get(directory) || 0) + 1);
    this.set(directory, id, type, event.type);
  }
  snapshot(directory, statuses, revision) {
    if ((this.revisions.get(directory) || 0) !== revision) return; // A newer live event wins over an in-flight GET.
    const ids = new Set([...Object.keys(statuses), ...Array.from(this.active.values()).filter(v => v.directory === directory).map(v => v.id)]);
    const before = this.active.size;
    this.batching = true;
    try { for (const id of ids) this.set(directory, id, statuses[id]?.type || 'idle', 'session/status reconciliation'); }
    finally { this.batching = false; }
    if (before !== this.active.size) this.onChange(this.active.size, { source: 'session/status reconciliation', directory, status: this.active.size ? 'busy' : 'idle' });
  }
}

export class Detector {
  constructor(config, controller, log) {
    this.config = config; this.controller = controller; this.log = log;
    this.state = new TaskState((count, trigger) => controller.activity(count, trigger), log);
    this.directories = new Set(); this.abort = new AbortController();
    this.headers = {};
    if (process.env.OPENCODE_SERVER_PASSWORD) this.headers.Authorization = `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME || 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
  }
  async json(route, directory) {
    const url = new URL(route, this.config.url);
    if (directory) url.searchParams.set('directory', directory);
    const response = await fetch(url, { headers: this.headers, signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    return response.json();
  }
  async reconcile() {
    for (const directory of this.directories) {
      const revision = this.state.revisions.get(directory) || 0;
      const statuses = await this.json('/session/status', directory);
      this.state.snapshot(directory, statuses, revision);
    }
  }
  async run() {
    while (!this.abort.signal.aborted) {
      const streamAbort = new AbortController();
      let pollTimer; let watchdog; let consuming; let connectTimer;
      try {
        const info = await this.json('/path', this.config.directory);
        this.defaultDirectory = info.directory;
        this.directories.add(info.directory);
        connectTimer = setTimeout(() => streamAbort.abort(), 7000);
        const response = await fetch(new URL('/global/event', this.config.url), {
          headers: { ...this.headers, Accept: 'text/event-stream' },
          signal: AbortSignal.any([this.abort.signal, streamAbort.signal]),
        });
        clearTimeout(connectTimer);
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error(`Event stream failed: HTTP ${response.status}`);
        let lastEvent = Date.now();
        consuming = (async () => {
          for await (const raw of sse(response.body)) {
            lastEvent = Date.now();
            let global;
            try { global = JSON.parse(raw); } catch { this.log('event.invalid'); continue; }
            const event = global.payload || global;
            const directory = global.directory || this.defaultDirectory;
            if (this.config.directory && directory.toLowerCase() !== this.defaultDirectory.toLowerCase()) continue;
            if (directory !== 'global' && event.type?.startsWith('session.')) {
              this.directories.add(directory);
              this.state.event(directory, event);
            }
          }
        })();
        // Attach rejection handler immediately while initial reconciliation is pending.
        consuming.catch(() => {});
        await this.reconcile();
        this.controller.connection(true);
        this.log('opencode.connected', { url: this.config.url, directory: this.config.directory || 'all directories on this server' });
        let polling = false;
        pollTimer = setInterval(async () => {
          if (polling) return;
          polling = true;
          try { await this.reconcile(); }
          catch (error) { this.log('reconcile.error', { message: error.message }); streamAbort.abort(); }
          finally { polling = false; }
        }, this.config.reconcileMs);
        watchdog = setInterval(() => { if (Date.now() - lastEvent > 45000) streamAbort.abort(); }, 5000);
        await consuming;
        throw new Error('Event stream ended');
      } catch (error) {
        if (!this.abort.signal.aborted) this.log('opencode.disconnected', { message: error.message, retryMs: this.config.reconnectMs });
      } finally {
        clearTimeout(connectTimer); clearInterval(pollTimer); clearInterval(watchdog);
        streamAbort.abort();
        await consuming?.catch(() => {});
        this.controller.connection(false);
      }
      if (!this.abort.signal.aborted) await delay(this.config.reconnectMs, undefined, { signal: this.abort.signal }).catch(() => {});
    }
  }
  stop() { this.abort.abort(); }
}
