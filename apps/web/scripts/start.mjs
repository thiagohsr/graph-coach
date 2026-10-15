// Production server: runs the built Start bundle (dist/server/server.js) on Node.
// Reads its configuration at start, not at build (contracts/web-server.md §11): the single root .env,
// then the process environment (which wins). Listens on WEB_PORT on all interfaces; exits cleanly on SIGTERM.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const clientRoot = path.join(webRoot, 'dist', 'client');
const serverEntry = path.join(webRoot, 'dist', 'server', 'server.js');

try {
  process.loadEnvFile(path.resolve(webRoot, '..', '..', '.env'));
} catch {
  // No root .env (for example in a container that passes the environment directly).
}

const PEER_HEADER = 'x-coach-peer';
const port = Number(process.env.WEB_PORT || 3000);

const mod = await import(pathToFileURL(serverEntry).href);
try {
  mod.checkEnv?.();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const app = mod.default;

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Serves a built client file, or returns false when the path is not one. */
function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    return false;
  }
  if (pathname === '/' || pathname.endsWith('/')) return false;
  const file = path.join(clientRoot, pathname);
  if (!file.startsWith(clientRoot + path.sep)) return false;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
}

function toRequest(req, res) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (name.toLowerCase() === PEER_HEADER) continue; // never trust a client-supplied value
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }
  // The connection's peer, for X-Forwarded-For handling (src/server/trust.ts).
  if (req.socket.remoteAddress) headers.set(PEER_HEADER, req.socket.remoteAddress);

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  const url = `http://${req.headers.host ?? `localhost:${port}`}${req.url ?? '/'}`;
  const init = { method: req.method, headers, signal: controller.signal };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req);
    init.duplex = 'half';
  }
  return new Request(url, init);
}

async function sendResponse(response, res) {
  const headers = {};
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === 'set-cookie') continue;
    headers[name] = value;
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers['set-cookie'] = cookies;
  res.writeHead(response.status, response.statusText || undefined, headers);
  res.flushHeaders();
  if (!response.body) {
    res.end();
    return;
  }
  // Chunks are written as they arrive: event streams are never buffered here.
  const stream = Readable.fromWeb(response.body);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (serveStatic(req, res)) return;
    const response = await app.fetch(toRequest(req, res));
    await sendResponse(response, res);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'Service unavailable.' } }));
    } else {
      res.destroy();
    }
  }
});

// Event streams stay open for as long as a task runs.
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;

server.listen(port, '0.0.0.0', () => {
  console.log(`Graph Coach web listening on http://0.0.0.0:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  // Streams and slow clients get a few seconds, then are cut.
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
