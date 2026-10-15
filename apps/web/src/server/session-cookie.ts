import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// Encrypted session and transaction cookies (contracts/web-server.md §2). Pure functions: they produce
// `Set-Cookie` header values and read from a parsed cookie map, so any adapter (server route, server
// function, test) can use them.

export interface Session {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds when the access token expires. */
  expiresAt: number;
}

export interface AuthTransaction {
  state: string;
  codeVerifier: string;
  /** Already sanitised, same-site relative path. */
  redirect: string;
}

export interface CookieOptions {
  secret: string;
  secure: boolean;
}

export const SESSION_COOKIE = 'gc_session';
export const TRANSACTION_COOKIE = 'gc_auth_tx';
/** Largest `name=value` of one cookie, in bytes (browsers allow about 4,096 including attributes). */
export const CHUNK_LIMIT = 3800;
const SESSION_MAX_AGE = 30 * 24 * 3600;
const TRANSACTION_MAX_AGE = 10 * 60;
const CHUNK_NAME = /^gc_session\.(\d+)$/;

// --- Authenticated encryption (AES-256-GCM) -------------------------------------------------------------

function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'graph-coach-web', `cookie:${purpose}`, 32));
}

/** Returns base64url(iv | tag | ciphertext). `purpose` is bound into the key so cookies cannot be swapped. */
export function seal(payload: unknown, secret: string, purpose = 'session'): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

/** Returns the payload, or null for anything that does not authenticate. */
export function unseal<T = unknown>(value: string, secret: string, purpose = 'session'): T | null {
  try {
    const raw = Buffer.from(value, 'base64url');
    if (raw.length < 12 + 16 + 1) return null;
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, purpose), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as T;
  } catch {
    return null;
  }
}

// --- Cookie header helpers ------------------------------------------------------------------------------

export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

interface CookieAttributes {
  maxAge: number;
  secure: boolean;
}

function serialize(name: string, value: string, { maxAge, secure }: CookieAttributes): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export interface ParsedSetCookie {
  name: string;
  value: string;
  maxAge: number | undefined;
  path: string | undefined;
  httpOnly: boolean;
  sameSite: string | undefined;
  secure: boolean;
}

/** Reads a `Set-Cookie` header value (used by tests and by the proxy to apply cookies to a jar). */
export function parseSetCookie(header: string): ParsedSetCookie {
  const [pair = '', ...attrs] = header.split(';').map((s) => s.trim());
  const eq = pair.indexOf('=');
  const out: ParsedSetCookie = {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    maxAge: undefined,
    path: undefined,
    httpOnly: false,
    sameSite: undefined,
    secure: false,
  };
  for (const attr of attrs) {
    const [k = '', v] = attr.split('=');
    switch (k.toLowerCase()) {
      case 'max-age':
        out.maxAge = Number(v);
        break;
      case 'path':
        out.path = v;
        break;
      case 'httponly':
        out.httpOnly = true;
        break;
      case 'samesite':
        out.sameSite = v;
        break;
      case 'secure':
        out.secure = true;
        break;
    }
  }
  return out;
}

/** Names of the session chunks present in a cookie map, in numeric order. */
export function sessionCookieNames(cookies: Record<string, string>): string[] {
  return Object.keys(cookies)
    .filter((n) => CHUNK_NAME.test(n))
    .sort((a, b) => Number(CHUNK_NAME.exec(a)![1]) - Number(CHUNK_NAME.exec(b)![1]));
}

// --- Session ---------------------------------------------------------------------------------------------

function chunkName(i: number): string {
  return `${SESSION_COOKIE}.${i}`;
}

function sessionMaxAge(session: Session, now: number): number {
  if (session.refreshToken) return SESSION_MAX_AGE;
  return Math.max(1, Math.floor((session.expiresAt - now) / 1000));
}

/**
 * `Set-Cookie` values that store the session: one cookie per chunk, plus an expiry for every chunk in
 * `existing` that is no longer used. The first chunk is prefixed with the chunk count (`<count>.`).
 */
export function writeSession(
  session: Session,
  { secret, secure, existing = [], now = Date.now() }: CookieOptions & { existing?: string[]; now?: number },
): string[] {
  const sealed = seal(session, secret);
  // Budget per chunk: name, '=', and for the first chunk the count prefix (up to two digits and a dot).
  const budget = (i: number) => CHUNK_LIMIT - chunkName(i).length - 1 - (i === 0 ? 3 : 0);
  const chunks: string[] = [];
  for (let pos = 0; pos < sealed.length || chunks.length === 0; ) {
    const size = budget(chunks.length);
    chunks.push(sealed.slice(pos, pos + size));
    pos += size;
  }
  const attrs = { maxAge: sessionMaxAge(session, now), secure };
  const headers = chunks.map((c, i) => serialize(chunkName(i), i === 0 ? `${chunks.length}.${c}` : c, attrs));
  for (const name of existing) {
    const m = CHUNK_NAME.exec(name);
    if (m && Number(m[1]) >= chunks.length) headers.push(serialize(name, '', { maxAge: 0, secure }));
  }
  return headers;
}

/** The session in a cookie map, or null when absent, incomplete, altered, or sealed with another secret. */
export function readSession(cookies: Record<string, string>, secret: string): Session | null {
  const first = cookies[chunkName(0)];
  if (!first) return null;
  const dot = first.indexOf('.');
  const count = Number(first.slice(0, dot));
  if (dot < 1 || !Number.isInteger(count) || count < 1 || count > 20) return null;
  let sealed = first.slice(dot + 1);
  for (let i = 1; i < count; i++) {
    const chunk = cookies[chunkName(i)];
    if (chunk === undefined) return null;
    sealed += chunk;
  }
  const payload = unseal<Partial<Session>>(sealed, secret);
  if (!payload || typeof payload.accessToken !== 'string' || typeof payload.expiresAt !== 'number') return null;
  const session: Session = { accessToken: payload.accessToken, expiresAt: payload.expiresAt };
  if (typeof payload.refreshToken === 'string') session.refreshToken = payload.refreshToken;
  return session;
}

/** Expires every chunk in `existing`, and always the first one. */
export function clearSession({ secure, existing = [] }: CookieOptions & { existing?: string[] }): string[] {
  const names = new Set([chunkName(0), ...existing.filter((n) => CHUNK_NAME.test(n))]);
  return [...names].map((n) => serialize(n, '', { maxAge: 0, secure }));
}

// --- Sign-in transaction ----------------------------------------------------------------------------------

export function writeTransaction(tx: AuthTransaction, { secret, secure }: CookieOptions): string {
  return serialize(TRANSACTION_COOKIE, seal(tx, secret, 'tx'), { maxAge: TRANSACTION_MAX_AGE, secure });
}

export function readTransaction(cookies: Record<string, string>, secret: string): AuthTransaction | null {
  const value = cookies[TRANSACTION_COOKIE];
  if (!value) return null;
  const tx = unseal<Partial<AuthTransaction>>(value, secret, 'tx');
  if (!tx || typeof tx.state !== 'string' || typeof tx.codeVerifier !== 'string' || typeof tx.redirect !== 'string') return null;
  return { state: tx.state, codeVerifier: tx.codeVerifier, redirect: tx.redirect };
}

export function clearTransaction({ secure }: CookieOptions): string {
  return serialize(TRANSACTION_COOKIE, '', { maxAge: 0, secure });
}
