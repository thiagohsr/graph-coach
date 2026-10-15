import { Inject, Injectable, Optional } from '@nestjs/common';
import { CLOCK, type Clock } from '../clock';
import { RateLimitedError } from '../errors/app-error';
import { MemoryRateLimitStore, type RateLimitStore } from './memory-store';

export interface RateLimitWindow {
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitRule {
  name: string;
  /** One or more; all must allow. */
  windows: RateLimitWindow[];
  /** The only code the limiter itself produces. */
  code?: 'RATE_LIMITED';
}

export interface WindowUsage {
  name: string;
  limit: number;
  used: number;
  remaining: number;
  resetAt: Date;
}

export interface RateLimitResult {
  allowed: boolean;
  /** The window that refused: among exhausted windows, the one that frees up last. Undefined when allowed. */
  window?: string;
  resetAt: Date;
  retryAfterSeconds: number;
  windows: WindowUsage[];
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

const storeKey = (ruleName: string, key: string) => `${ruleName}\u0000${key}`;

/** Sliding-window limiter (contracts/internal-interfaces.md §5.4). Time comes from `CLOCK`. */
@Injectable()
export class RateLimiter {
  private readonly store: RateLimitStore;

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(RATE_LIMIT_STORE) store?: RateLimitStore,
  ) {
    this.store = store ?? new MemoryRateLimitStore();
  }

  /** Counts one event in every window if all allow it; counts nothing if any refuses. Does not throw. */
  async consume(rule: RateLimitRule, key: string): Promise<RateLimitResult> {
    return this.evaluate(rule, key, true);
  }

  /** Reports without counting. */
  async peek(rule: RateLimitRule, key: string): Promise<RateLimitResult> {
    return this.evaluate(rule, key, false);
  }

  /** consume(), and throws RateLimitedError when refused. */
  async enforce(rule: RateLimitRule, key: string): Promise<RateLimitResult> {
    const result = await this.consume(rule, key);
    if (!result.allowed) {
      throw new RateLimitedError(
        {
          resetAt: result.resetAt,
          retryAfterSeconds: result.retryAfterSeconds,
          ...(result.window !== undefined ? { window: result.window } : {}),
        },
        rule.code ?? 'RATE_LIMITED',
      );
    }
    return result;
  }

  /** How many events the key has in the last windowMs, per requested window. */
  async usage(
    ruleName: string,
    key: string,
    windows: Array<{ name: string; windowMs: number }>,
  ): Promise<Array<{ name: string; used: number }>> {
    const now = this.clock.now().getTime();
    const longest = Math.max(0, ...windows.map((w) => w.windowMs));
    const events = await this.store.list(storeKey(ruleName, key), now, longest);
    return windows.map((w) => ({
      name: w.name,
      used: events.filter((t) => t > now - w.windowMs).length,
    }));
  }

  /** Forgets the key's events for this rule. */
  async reset(ruleName: string, key: string): Promise<void> {
    await this.store.delete(storeKey(ruleName, key));
  }

  private async evaluate(rule: RateLimitRule, key: string, count: boolean): Promise<RateLimitResult> {
    const now = this.clock.now().getTime();
    const longest = Math.max(...rule.windows.map((w) => w.windowMs));
    const events = await this.store.list(storeKey(rule.name, key), now, longest);

    const states = rule.windows.map((w) => {
      const inWindow = events.filter((t) => t > now - w.windowMs);
      const exhausted = inWindow.length >= w.limit;
      // A refusing window has room once enough of its oldest events have left.
      const freesAt = exhausted
        ? w.limit === 0
          ? now + w.windowMs
          : inWindow[inWindow.length - w.limit]! + w.windowMs
        : now;
      return { window: w, inWindow, exhausted, freesAt };
    });

    const refusing = states.filter((s) => s.exhausted);
    if (refusing.length > 0) {
      const last = refusing.reduce((a, b) => (b.freesAt > a.freesAt ? b : a));
      return {
        allowed: false,
        window: last.window.name,
        resetAt: new Date(last.freesAt),
        retryAfterSeconds: Math.max(1, Math.ceil((last.freesAt - now) / 1000)),
        windows: states.map((s) => this.usageOf(s.window, s.inWindow, now)),
      };
    }

    let after = events;
    if (count) {
      await this.store.add(storeKey(rule.name, key), now, longest);
      after = [...events, now];
    }
    const windows = rule.windows.map((w) =>
      this.usageOf(
        w,
        after.filter((t) => t > now - w.windowMs),
        now,
      ),
    );
    return {
      allowed: true,
      resetAt: new Date(Math.min(...windows.map((w) => w.resetAt.getTime()))),
      retryAfterSeconds: 0,
      windows,
    };
  }

  private usageOf(window: RateLimitWindow, inWindow: number[], now: number): WindowUsage {
    const oldest = inWindow[0];
    return {
      name: window.name,
      limit: window.limit,
      used: inWindow.length,
      remaining: Math.max(0, window.limit - inWindow.length),
      resetAt: new Date(oldest === undefined ? now : oldest + window.windowMs),
    };
  }
}
