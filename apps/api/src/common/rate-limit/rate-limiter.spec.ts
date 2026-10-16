import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../clock';
import { RateLimitedError } from '../errors/app-error';
import { RateLimiter, type RateLimitRule } from './rate-limiter';

class FakeClock implements Clock {
  constructor(private ms = Date.UTC(2026, 9, 15, 12, 0, 0)) {}
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

const MIN = 60_000;
const oneWindow: RateLimitRule = {
  name: 'shares',
  windows: [{ name: 'main', limit: 3, windowMs: 10 * MIN }],
};
const twoWindows: RateLimitRule = {
  name: 'codes.redeem',
  windows: [
    { name: 'short', limit: 5, windowMs: 10 * MIN },
    { name: 'day', limit: 20, windowMs: 24 * 60 * MIN },
  ],
};

let clock: FakeClock;
let limiter: RateLimiter;

beforeEach(() => {
  clock = new FakeClock();
  limiter = new RateLimiter(clock);
});

describe('one window', () => {
  it('allows `limit` events then refuses', async () => {
    for (let i = 0; i < 3; i += 1)
      expect((await limiter.consume(oneWindow, 'u1')).allowed).toBe(true);
    const refused = await limiter.consume(oneWindow, 'u1');
    expect(refused.allowed).toBe(false);
    expect(refused.window).toBe('main');
  });

  it('frees one slot when the oldest event leaves the sliding window', async () => {
    await limiter.consume(oneWindow, 'u1'); // t0
    clock.advance(4 * MIN);
    await limiter.consume(oneWindow, 'u1'); // t0+4
    await limiter.consume(oneWindow, 'u1'); // t0+4
    expect((await limiter.consume(oneWindow, 'u1')).allowed).toBe(false);
    clock.advance(6 * MIN - 1); // the t0 event is 1 ms short of leaving
    expect((await limiter.consume(oneWindow, 'u1')).allowed).toBe(false);
    clock.advance(1);
    expect((await limiter.consume(oneWindow, 'u1')).allowed).toBe(true);
    expect((await limiter.consume(oneWindow, 'u1')).allowed).toBe(false);
  });

  it('reports used, remaining, resetAt, and retryAfterSeconds', async () => {
    const start = clock.now().getTime();
    const first = await limiter.consume(oneWindow, 'u1');
    expect(first.allowed).toBe(true);
    expect(first.retryAfterSeconds).toBe(0);
    expect(first.windows).toEqual([
      { name: 'main', limit: 3, used: 1, remaining: 2, resetAt: new Date(start + 10 * MIN) },
    ]);
    clock.advance(MIN);
    await limiter.consume(oneWindow, 'u1');
    await limiter.consume(oneWindow, 'u1');
    clock.advance(30_500);
    const refused = await limiter.consume(oneWindow, 'u1');
    expect(refused.allowed).toBe(false);
    expect(refused.resetAt).toEqual(new Date(start + 10 * MIN));
    // 10 min - 1 min - 30.5 s = 8 min 29.5 s, rounded up to 510 s
    expect(refused.retryAfterSeconds).toBe(510);
    expect(refused.windows[0]).toMatchObject({ used: 3, remaining: 0 });
  });

  it('peek does not count', async () => {
    for (let i = 0; i < 10; i += 1)
      expect((await limiter.peek(oneWindow, 'u1')).allowed).toBe(true);
    expect((await limiter.peek(oneWindow, 'u1')).windows[0]!.used).toBe(0);
    await limiter.consume(oneWindow, 'u1');
    expect((await limiter.peek(oneWindow, 'u1')).windows[0]!.used).toBe(1);
  });

  it('limit 0 refuses everything', async () => {
    const blocked: RateLimitRule = {
      name: 'off',
      windows: [{ name: 'main', limit: 0, windowMs: MIN }],
    };
    const result = await limiter.consume(blocked, 'u1');
    expect(result.allowed).toBe(false);
    expect(result.window).toBe('main');
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keys and rules are independent', async () => {
    for (let i = 0; i < 3; i += 1) await limiter.consume(oneWindow, 'u1');
    expect((await limiter.consume(oneWindow, 'u1')).allowed).toBe(false);
    expect((await limiter.consume(oneWindow, 'u2')).allowed).toBe(true);
    const other: RateLimitRule = { name: 'other', windows: oneWindow.windows };
    expect((await limiter.consume(other, 'u1')).allowed).toBe(true);
  });
});

describe('two windows', () => {
  it('refuses on the short window first, then on the day window, and counts nothing on a refusal', async () => {
    for (let i = 0; i < 5; i += 1)
      expect((await limiter.consume(twoWindows, 'u1')).allowed).toBe(true);
    const shortRefusal = await limiter.consume(twoWindows, 'u1');
    expect(shortRefusal.allowed).toBe(false);
    expect(shortRefusal.window).toBe('short');
    // The refusal consumed nothing from the day window.
    expect(
      await limiter.usage('codes.redeem', 'u1', [{ name: 'day', windowMs: 24 * 60 * MIN }]),
    ).toEqual([{ name: 'day', used: 5 }]);

    // Three more batches of five, each after the short window has emptied: 20 events in the day.
    for (let batch = 0; batch < 3; batch += 1) {
      clock.advance(11 * MIN);
      for (let i = 0; i < 5; i += 1)
        expect((await limiter.consume(twoWindows, 'u1')).allowed).toBe(true);
    }
    clock.advance(11 * MIN);
    const dayRefusal = await limiter.consume(twoWindows, 'u1');
    expect(dayRefusal.allowed).toBe(false);
    expect(dayRefusal.window).toBe('day');
    expect(dayRefusal.windows.find((w) => w.name === 'short')!.used).toBe(0);
    expect(dayRefusal.windows.find((w) => w.name === 'day')).toMatchObject({
      used: 20,
      remaining: 0,
    });
    expect(
      (await limiter.usage('codes.redeem', 'u1', [{ name: 'day', windowMs: 24 * 60 * MIN }]))[0]!
        .used,
    ).toBe(20);
  });

  it('names the window that frees up last when both are exhausted', async () => {
    const both: RateLimitRule = {
      name: 'both',
      windows: [
        { name: 'short', limit: 1, windowMs: MIN },
        { name: 'long', limit: 1, windowMs: 60 * MIN },
      ],
    };
    await limiter.consume(both, 'u1');
    const refused = await limiter.consume(both, 'u1');
    expect(refused.window).toBe('long');
    expect(refused.retryAfterSeconds).toBe(3600);
  });
});

describe('usage, reset, enforce', () => {
  it('usage reports counts per requested window', async () => {
    await limiter.consume(twoWindows, 'u1');
    clock.advance(20 * MIN);
    await limiter.consume(twoWindows, 'u1');
    expect(
      await limiter.usage('codes.redeem', 'u1', [
        { name: 'short', windowMs: 10 * MIN },
        { name: 'day', windowMs: 24 * 60 * MIN },
      ]),
    ).toEqual([
      { name: 'short', used: 1 },
      { name: 'day', used: 2 },
    ]);
  });

  it('reset clears the key for the rule', async () => {
    for (let i = 0; i < 3; i += 1) await limiter.consume(oneWindow, 'u1');
    await limiter.reset('shares', 'u1');
    expect((await limiter.consume(oneWindow, 'u1')).allowed).toBe(true);
  });

  it('enforce throws RateLimitedError with the rule code and details including the window', async () => {
    for (let i = 0; i < 3; i += 1) await limiter.enforce(oneWindow, 'u1');
    const error = await limiter.enforce(oneWindow, 'u1').then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RateLimitedError);
    const limited = error as RateLimitedError;
    expect(limited.code).toBe('RATE_LIMITED');
    expect(limited.status).toBe(429);
    expect(limited.details).toMatchObject({ window: 'main', retryAfterSeconds: 600 });
  });
});
