// Request handling of the production server (scripts/start.mjs), kept apart so it can be tested.
// The internal peer header is dealt with once, first, for every request (`preparePeer`), before static
// files, server functions, the /api route, SSR, /healthz, or unknown paths are looked at.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

export const PEER_HEADER = 'x-coach-peer';

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

/**
 * Removes any client-supplied peer header from the incoming message, then sets it from the socket's real
 * peer address (or leaves it absent when the socket has none). Mutates `req.headers`.
 */
export function preparePeer(req) {
  for (const name of Object.keys(req.headers)) {
    if (name.toLowerCase() === PEER_HEADER) delete req.headers[name];
  }
  const peer = req.socket?.remoteAddress;
  if (peer) req.headers[PEER_HEADER] = peer;
}

/** Serves a built client file, or returns false when the path is not one. */
export function createStaticServer(clientRoot) {
  return function serveStatic(req, res) {
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
  };
}

/** Builds the Web `Request` from a (prepared) incoming message. */
export function toRequest(req, res, port) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }

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

export async function sendResponse(response, res) {
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

/** The `http.createServer` listener. `serveStatic` is injectable for tests. */
export function createRequestHandler({ app, serveStatic, port }) {
  return async (req, res) => {
    try {
      preparePeer(req); // first, for every request
      if (serveStatic(req, res)) return;
      const response = await app.fetch(toRequest(req, res, port));
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
  };
}
