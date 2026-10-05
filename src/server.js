import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
export function createControlServer({ controller, root, shutdown }) {
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  return http.createServer(async (req, res) => {
    try {
      const origin = 'http://127.0.0.1:' + req.socket.localPort;
      if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Use ' + origin });
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, controller.status());
        if (!['POST', 'PATCH', 'PUT'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
        if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Cross-origin requests are not allowed' });
        if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Cross-site requests are not allowed' });
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 415, { error: 'JSON required' });
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 4096) return json(res, 413, { error: 'Request too large' });
        }
        let body;
        try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'JSON object required' });
        const route = req.method + ' ' + url.pathname;
        if (route === 'PATCH /api/settings') await controller.updateSettings(body);
        else if (route === 'PUT /api/auto-scroll') {
          if (Object.keys(body).some(key => key !== 'enabled')) return json(res, 400, { error: 'Unknown option' });
          controller.setAutoScroll(body.enabled);
        } else {
          if (Object.keys(body).length) return json(res, 400, { error: 'This action takes no options' });
          if (route === 'POST /api/start') await controller.start();
          else if (route === 'POST /api/stop') await controller.stop();
          else if (route === 'POST /api/open') await controller.openManually();
          else if (route === 'POST /api/shutdown') {
            await shutdown();
            return json(res, 200, { ...controller.status(), shutdown: true });
          } else return json(res, 404, { error: 'Unknown action' });
        }
        return json(res, 200, controller.status());
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      const base = path.resolve(root, 'dist');
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(base, relative);
      if (!file.startsWith(base + path.sep)) return json(res, 403, { error: 'Forbidden' });
      try {
        const data = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.end(data);
      } catch { json(res, 404, { error: 'Dashboard assets missing. Run npm.cmd install and npm.cmd run build.' }); }
    } catch (error) { json(res, 400, { error: error.message }); }
  });
}
