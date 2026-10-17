// In-memory sliding-window rate limits for the sign-in forms. One process, no shared store: enough for a
// single web server (the limits are a first line; Cognito enforces its own). Server-only.

export interface Verdict {
  allowed: boolean;
  /** Seconds until the oldest hit leaves the window; 0 when allowed. */
  retryAfterSeconds: number;
}

const MAX_KEYS = 20_000;

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string, windowMs: number): number[] {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((h) => t - h < windowMs);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  /** Would one more hit be allowed? Records nothing. */
  peek(key: string, max: number, windowMs: number): Verdict {
    const list = this.live(key, windowMs);
    if (list.length < max) return { allowed: true, retryAfterSeconds: 0 };
    const oldest = list[list.length - max] ?? list[0]!;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - this.now()) / 1000)),
    };
  }

  record(key: string, windowMs: number): void {
    const list = this.live(key, windowMs);
    list.push(this.now());
    this.hits.set(key, list);
    if (this.hits.size > MAX_KEYS) this.prune(windowMs);
  }

  /** Check, and record when allowed. */
  take(key: string, max: number, windowMs: number): Verdict {
    const v = this.peek(key, max, windowMs);
    if (v.allowed) this.record(key, windowMs);
    return v;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(windowMs: number): void {
    const t = this.now();
    for (const [k, list] of this.hits) {
      if (list.every((h) => t - h >= windowMs)) this.hits.delete(k);
    }
    // Still too many (all fresh): drop the oldest-inserted keys.
    for (const k of this.hits.keys()) {
      if (this.hits.size <= MAX_KEYS) break;
      this.hits.delete(k);
    }
  }
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export interface Rule {
  max: number;
  windowMs: number;
}

/** The numbers of the design (contracts/server-functions.md). */
export const LIMITS = {
  signInPairFailures: { max: 5, windowMs: 15 * MIN },
  signInIpFailures: { max: 30, windowMs: 15 * MIN },
  signInEmailFailures: { max: 20, windowMs: HOUR },
  signUpIp: { max: 5, windowMs: HOUR },
  signUpEmail: { max: 3, windowMs: HOUR },
  resendEmailBurst: { max: 1, windowMs: 30_000 },
  resendEmailHour: { max: 5, windowMs: HOUR },
  resendIp: { max: 10, windowMs: HOUR },
  forgotEmail: { max: 3, windowMs: HOUR },
  forgotIp: { max: 10, windowMs: HOUR },
  codePairFailures: { max: 5, windowMs: 15 * MIN },
  codeIp: { max: 20, windowMs: HOUR },
} as const satisfies Record<string, Rule>;

export type AuthLimits = SlidingWindowLimiter;

let shared: SlidingWindowLimiter | undefined;
export function sharedLimits(): SlidingWindowLimiter {
  shared ??= new SlidingWindowLimiter();
  return shared;
}
