import type { CfAccess } from './config';
import { cfAccessHeaders } from './headers';

export const HEALTH_TIMEOUT_MS = 2_000;
export const HEALTH_CACHE_TTL_MS = 30_000;

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean }>;

export interface OllamaHealthOptions {
  baseUrl: string;
  cfAccess?: CfAccess | undefined;
  /** Test hooks. */
  fetch?: FetchLike | undefined;
  now?: (() => number) | undefined;
  timeoutMs?: number | undefined;
  ttlMs?: number | undefined;
}

/**
 * `GET <baseUrl>/api/tags` with a short timeout. The result (up or down) is cached for `ttlMs`, so a run start costs
 * at most one probe per window. Never throws, never logs: it holds the Access token only to send it.
 */
export function createOllamaHealthCheck(options: OllamaHealthOptions): () => Promise<boolean> {
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const ttlMs = options.ttlMs ?? HEALTH_CACHE_TTL_MS;
  const headers = cfAccessHeaders(options.cfAccess);
  const url = `${options.baseUrl.replace(/\/+$/, '')}/api/tags`;
  let cached: { at: number; up: boolean } | null = null;

  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.up;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    let up = false;
    try {
      const res = await doFetch(url, {
        signal: controller.signal,
        ...(headers ? { headers } : {}),
      });
      up = res.ok;
    } catch {
      up = false;
    } finally {
      clearTimeout(timer);
    }
    cached = { at: now(), up };
    return up;
  };
}
