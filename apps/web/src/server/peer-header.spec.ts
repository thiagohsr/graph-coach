// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PEER_HEADER, createRequestHandler, preparePeer } from '../../scripts/request.mjs';
import { forwardedFor, peerAddress } from './trust';

// Decision 10: a client-supplied x-coach-peer header must never reach the trust check, on any request path.

const SPOOF = '10.99.99.99';

/** What the fake app saw for each request: the header value the trust check would read. */
const seen: { path: string; peer: string | undefined; xff: string | undefined }[] = [];
/** What the static-file stage saw (it runs before the app). */
const staticSeen: { path: string; peer: string | undefined }[] = [];

// A stand-in for the built Start server: one fetch handler, answering like the real route table would.
const app = {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    const peer = peerAddress(request);
    seen.push({
      path: url.pathname,
      peer,
      xff: forwardedFor(peer, request.headers.get('x-forwarded-for'), undefined),
    });
    if (url.pathname === '/healthz') return Response.json({ ok: true });
    if (url.pathname.startsWith('/api/')) return Response.json({ api: true });
    if (url.pathname.startsWith('/_serverFn/')) return Response.json({ fn: true });
    if (url.pathname === '/puzzles' || url.pathname === '/')
      return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    return new Response('nope', { status: 404 });
  },
};

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer(
    createRequestHandler({
      app,
      port: 0,
      // Static stage: claims /assets/* (so the app is not reached), and records what it saw.
      serveStatic: (req, res) => {
        if (!req.url?.startsWith('/assets/')) return false;
        staticSeen.push({ path: req.url, peer: req.headers[PEER_HEADER] as string | undefined });
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end('// static');
        return true;
      },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function get(path: string, headers: http.OutgoingHttpHeaders, method = 'GET'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

const isLoopback = (peer: string | undefined) =>
  peer === '127.0.0.1' || peer === '::ffff:127.0.0.1' || peer === '::1';

describe('x-coach-peer is replaced by the real socket peer on every request path', () => {
  const dynamicPaths: [string, string, string][] = [
    ['server function', 'POST', '/_serverFn/abc123'],
    ['/api forwarding route (GET)', 'GET', '/api/puzzles'],
    ['/api forwarding route (POST)', 'POST', '/api/sessions'],
    ['page SSR', 'GET', '/puzzles'],
    ['root page', 'GET', '/'],
    ['/healthz', 'GET', '/healthz'],
    ['unknown path', 'GET', '/no/such/thing'],
  ];

  it.each(dynamicPaths)('%s', async (_label, method, path) => {
    seen.length = 0;
    await get(path, { [PEER_HEADER]: SPOOF, 'x-forwarded-for': '203.0.113.5' }, method);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.peer).not.toBe(SPOOF);
    expect(isLoopback(seen[0]!.peer)).toBe(true);
    // With an untrusted peer the trust check drops the incoming chain and uses the real peer alone.
    expect(seen[0]!.xff).toBe(seen[0]!.peer);
  });

  it('static files (the header is already replaced when the static stage runs)', async () => {
    staticSeen.length = 0;
    seen.length = 0;
    const status = await get('/assets/app.js', { [PEER_HEADER]: SPOOF });
    expect(status).toBe(200);
    expect(seen).toHaveLength(0);
    expect(staticSeen).toHaveLength(1);
    expect(staticSeen[0]!.peer).not.toBe(SPOOF);
    expect(isLoopback(staticSeen[0]!.peer)).toBe(true);
  });

  it('a differently cased header name is removed too', async () => {
    seen.length = 0;
    await get('/api/x', { 'X-Coach-Peer': SPOOF });
    expect(seen[0]!.peer).not.toBe(SPOOF);
    expect(isLoopback(seen[0]!.peer)).toBe(true);
  });

  it('a repeated header is removed entirely, leaving only the real peer', async () => {
    seen.length = 0;
    await get('/api/x', { [PEER_HEADER]: [SPOOF, '10.1.1.1'] });
    expect(seen[0]!.peer).not.toContain('10.');
    expect(isLoopback(seen[0]!.peer)).toBe(true);
  });
});

describe('preparePeer', () => {
  it('removes a supplied header and leaves none when the socket has no address', () => {
    const req = {
      headers: { 'x-coach-peer': SPOOF, host: 'a' } as Record<string, string>,
      socket: {},
    };
    preparePeer(req);
    expect(req.headers[PEER_HEADER]).toBeUndefined();
    expect(req.headers.host).toBe('a');
  });

  it('overwrites with the socket address', () => {
    const req = {
      headers: { 'X-Coach-Peer': SPOOF } as Record<string, string>,
      socket: { remoteAddress: '192.0.2.7' },
    };
    preparePeer(req);
    expect(req.headers[PEER_HEADER]).toBe('192.0.2.7');
    expect(Object.keys(req.headers)).toEqual([PEER_HEADER]);
  });
});
