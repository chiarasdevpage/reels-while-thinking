import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

// Only this known media file is served; request paths never become file paths.
export async function serveGameplay(req, res, root) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
  }
  let file;
  try {
    file = await fs.open(path.join(root, 'runtime', 'media', 'subway-surfers.mp4'), 'r');
    const info = await file.stat();
    if (!info.isFile() || !info.size) throw new Error('Empty gameplay clip');
    const headers = {
      'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    };
    let start = 0, end = info.size - 1, partial = false;
    // RFC 9110: Range applies to GET; HEAD describes the complete representation.
    if (req.method === 'GET' && req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      let valid = Boolean(match && (match[1] || match[2]));
      if (valid) {
        const first = match[1] ? Number(match[1]) : null;
        const last = match[2] ? Number(match[2]) : null;
        valid = [first, last].every(n => n === null || Number.isSafeInteger(n));
        if (first === null) { start = Math.max(0, info.size - last); valid &&= last > 0; }
        else { start = first; end = last === null ? end : Math.min(end, last); }
        valid &&= start <= end && start < info.size;
      }
      if (!valid) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}`, 'Content-Length': 0 });
        res.end(); return;
      }
      partial = true;
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(partial ? 206 : 200, headers);
    if (req.method === 'HEAD') res.end();
    else await pipeline(file.createReadStream({ start, end, autoClose: false }), res);
  } catch (error) {
    if (res.headersSent) { if (!res.destroyed) res.destroy(); }
    else {
      const missing = error.code === 'ENOENT';
      res.writeHead(missing ? 404 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: missing ? 'No gameplay clip yet. Add your clip using the README setup steps.' : 'The gameplay clip cannot be read. Check or replace the file.' }));
    }
  } finally { await file?.close(); }
}
