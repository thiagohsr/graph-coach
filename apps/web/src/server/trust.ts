import { isIP } from 'node:net';

// Behind the TLS proxy (contracts/web-server.md §9).

/** Header the server adapters (scripts/start.mjs and the dev-server plugin) set from the socket's peer. */
export const PEER_HEADER = 'x-coach-peer';

/** The address of the connection that reached this server, or undefined when the adapter did not say. */
export function peerAddress(request: Request): string | undefined {
  return request.headers.get(PEER_HEADER) ?? undefined;
}

interface ParsedIp {
  family: 4 | 6;
  value: bigint;
}

function parseIPv4(ip: string): bigint {
  return ip.split('.').reduce((acc, part) => (acc << 8n) + BigInt(part), 0n);
}

function parseIPv6(ip: string): bigint {
  let text = ip;
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const v4 = parseIPv4(tail[1]!);
    text =
      text.slice(0, -tail[1]!.length) +
      `${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const headParts = head ? head.split(':') : [];
  const restParts = rest === undefined ? [] : rest ? rest.split(':') : [];
  const missing = 8 - headParts.length - restParts.length;
  const groups =
    rest === undefined
      ? headParts
      : [...headParts, ...Array<string>(missing).fill('0'), ...restParts];
  return groups.reduce((acc, g) => (acc << 16n) + BigInt(`0x${g}`), 0n);
}

function parseIp(raw: string): ParsedIp | null {
  const family = isIP(raw.includes('%') ? raw.slice(0, raw.indexOf('%')) : raw);
  if (family === 4) return { family: 4, value: parseIPv4(raw) };
  if (family === 6) {
    const value = parseIPv6(raw);
    // IPv4-mapped (::ffff:a.b.c.d) is the IPv4 address.
    if (value >> 32n === 0xffffn) return { family: 4, value: value & 0xffffffffn };
    return { family: 6, value };
  }
  return null;
}

function inRange(ip: ParsedIp, base: ParsedIp, prefix: number): boolean {
  if (ip.family !== base.family) return false;
  const bits = ip.family === 4 ? 32 : 128;
  if (prefix < 0 || prefix > bits) return false;
  const shift = BigInt(bits - prefix);
  return ip.value >> shift === base.value >> shift;
}

/** Same format as the API's TRUST_PROXY: `loopback`, addresses, and CIDR ranges, comma-separated. */
export function isTrustedPeer(peer: string | undefined, setting: string | undefined): boolean {
  if (!peer || !setting) return false;
  const ip = parseIp(peer.trim());
  if (!ip) return false;
  for (const entryRaw of setting.split(',')) {
    const entry = entryRaw.trim();
    if (!entry || entry.toLowerCase() === 'false') continue;
    if (entry.toLowerCase() === 'loopback') {
      const v4 = parseIp('127.0.0.0')!;
      const v6 = parseIp('::1')!;
      if (inRange(ip, v4, 8) || inRange(ip, v6, 128)) return true;
      continue;
    }
    const [addr = '', prefixText] = entry.split('/');
    const base = parseIp(addr);
    if (!base) continue;
    const prefix = prefixText === undefined ? (base.family === 4 ? 32 : 128) : Number(prefixText);
    if (Number.isInteger(prefix) && inRange(ip, base, prefix)) return true;
  }
  return false;
}

/**
 * The `X-Forwarded-For` value for upstream calls. From a trusted proxy the incoming header is kept and the
 * peer appended; from any other peer the incoming header is discarded and the value is the peer alone.
 */
export function forwardedFor(
  peer: string | undefined,
  incoming: string | null | undefined,
  trustProxy: string | undefined,
): string | undefined {
  if (!peer) return undefined;
  const chain = incoming?.trim();
  if (chain && isTrustedPeer(peer, trustProxy)) return `${chain}, ${peer}`;
  return peer;
}

/** `WEB_ORIGIN` when set, else the origin of the request URL (local development). */
export function publicOrigin(requestUrl: string, webOrigin: string | undefined): string {
  return webOrigin ? webOrigin.replace(/\/+$/, '') : new URL(requestUrl).origin;
}

/** A missing Origin passes; otherwise it must equal the public origin exactly. */
export function originAllowed(originHeader: string | null | undefined, origin: string): boolean {
  if (originHeader === null || originHeader === undefined) return true;
  return originHeader === origin;
}
