import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, service } from './router.js';

const PORT = Number(process.env.PORT || 8787);
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,x-ingest-key', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

// Serve the built frontend from the same process (one container = one URL).
const STATIC = process.env.STATIC_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(url, res) {
  if (!existsSync(STATIC)) return false;
  let file = normalize(join(STATIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(STATIC) || !existsSync(file)) file = join(STATIC, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
  return true;
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    let raw = '';
    for await (const c of req) raw += c;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api') && req.method === 'GET' && serveStatic(url, res)) return;
    try {
      const r = await handle({ method: req.method, path: url.pathname, body, headers: req.headers, ip: req.socket.remoteAddress });
      res.writeHead(r.status, { 'content-type': 'application/json', ...cors }).end(JSON.stringify(r.body));
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'content-type': 'application/json', ...cors }).end(JSON.stringify({ error: 'Internal error' }));
    }
  })
  .listen(PORT, () => console.log(`AegisGrid API on http://localhost:${PORT}`));

// Simulated hospital-system heartbeats: connected facilities report in; two feeds stay down to show stale-data handling.
setInterval(() => service.heartbeat(), 15000).unref();
