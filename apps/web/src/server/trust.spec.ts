// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { healthHandler } from './health';
import { forwardedFor, isTrustedPeer, originAllowed, peerAddress, publicOrigin } from './trust';

describe('isTrustedPeer', () => {
  it('trusts nobody when the setting is empty or false', () => {
    expect(isTrustedPeer('127.0.0.1', '')).toBe(false);
    expect(isTrustedPeer('127.0.0.1', undefined)).toBe(false);
    expect(isTrustedPeer('127.0.0.1', 'false')).toBe(false);
  });

  it('handles loopback in both families', () => {
    expect(isTrustedPeer('127.0.0.1', 'loopback')).toBe(true);
    expect(isTrustedPeer('127.5.5.5', 'loopback')).toBe(true);
    expect(isTrustedPeer('::1', 'loopback')).toBe(true);
    expect(isTrustedPeer('::ffff:127.0.0.1', 'loopback')).toBe(true);
    expect(isTrustedPeer('10.0.0.1', 'loopback')).toBe(false);
  });

  it('handles CIDR ranges', () => {
    expect(isTrustedPeer('172.28.3.4', '172.28.0.0/16')).toBe(true);
    expect(isTrustedPeer('172.29.0.1', '172.28.0.0/16')).toBe(false);
    expect(isTrustedPeer('fd00::5', 'fd00::/8')).toBe(true);
    expect(isTrustedPeer('fe80::5', 'fd00::/8')).toBe(false);
  });

  it('handles exact addresses and comma-separated lists', () => {
    const setting = 'loopback, 172.28.0.0/16 ,203.0.113.7';
    expect(isTrustedPeer('203.0.113.7', setting)).toBe(true);
    expect(isTrustedPeer('203.0.113.8', setting)).toBe(false);
    expect(isTrustedPeer('172.28.1.1', setting)).toBe(true);
    expect(isTrustedPeer('127.0.0.1', setting)).toBe(true);
  });

  it('never trusts an unparseable peer or entry', () => {
    expect(isTrustedPeer('not-an-ip', 'loopback')).toBe(false);
    expect(isTrustedPeer('127.0.0.1', 'garbage')).toBe(false);
  });
});

describe('forwardedFor', () => {
  it('returns the peer alone when the peer is not trusted, dropping a browser-supplied header', () => {
    expect(forwardedFor('203.0.113.9', '1.2.3.4', '')).toBe('203.0.113.9');
    expect(forwardedFor('203.0.113.9', '1.2.3.4', 'loopback')).toBe('203.0.113.9');
  });

  it('keeps the incoming header and appends the peer when the peer is a trusted proxy', () => {
    expect(forwardedFor('172.28.0.2', '198.51.100.4', '172.28.0.0/16')).toBe('198.51.100.4, 172.28.0.2');
    expect(forwardedFor('127.0.0.1', '198.51.100.4, 10.0.0.1', 'loopback')).toBe('198.51.100.4, 10.0.0.1, 127.0.0.1');
  });

  it('returns the peer alone from a trusted proxy that sent no header', () => {
    expect(forwardedFor('127.0.0.1', null, 'loopback')).toBe('127.0.0.1');
  });

  it('returns undefined when the peer is unknown', () => {
    expect(forwardedFor(undefined, '1.2.3.4', 'loopback')).toBeUndefined();
  });
});

describe('peerAddress', () => {
  it('reads the internal header set by the server adapters', () => {
    expect(peerAddress(new Request('http://x/', { headers: { 'x-coach-peer': '10.1.1.1' } }))).toBe('10.1.1.1');
    expect(peerAddress(new Request('http://x/'))).toBeUndefined();
  });
});

describe('publicOrigin', () => {
  it('prefers WEB_ORIGIN and otherwise uses the request URL origin', () => {
    expect(publicOrigin('http://web:3000/api/x?y=1', 'https://coach.example.com')).toBe('https://coach.example.com');
    expect(publicOrigin('http://localhost:3000/api/x?y=1', undefined)).toBe('http://localhost:3000');
  });
});

describe('originAllowed', () => {
  it('accepts a missing Origin and the public origin, and rejects anything else', () => {
    expect(originAllowed(null, 'http://localhost:3000')).toBe(true);
    expect(originAllowed(undefined, 'http://localhost:3000')).toBe(true);
    expect(originAllowed('http://localhost:3000', 'http://localhost:3000')).toBe(true);
    expect(originAllowed('http://evil.example', 'http://localhost:3000')).toBe(false);
    expect(originAllowed('null', 'http://localhost:3000')).toBe(false);
  });
});

describe('healthHandler', () => {
  it('answers 200 { web: ok } with no-store and calls nothing upstream', async () => {
    const fetchSpy = globalThis.fetch;
    const res = healthHandler();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ web: 'ok' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(globalThis.fetch).toBe(fetchSpy);
  });
});
