// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LIMITS, SlidingWindowLimiter } from './auth-limits';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('SlidingWindowLimiter', () => {
  it('allows max hits per window and reports the wait', () => {
    const c = clock();
    const l = new SlidingWindowLimiter(c.now);
    for (let i = 0; i < 5; i++) expect(l.take('k', 5, 60_000).allowed).toBe(true);
    const v = l.take('k', 5, 60_000);
    expect(v).toEqual({ allowed: false, retryAfterSeconds: 60 });
    c.advance(20_000);
    expect(l.peek('k', 5, 60_000).retryAfterSeconds).toBe(40);
  });

  it('lets hits age out of the window', () => {
    const c = clock();
    const l = new SlidingWindowLimiter(c.now);
    for (let i = 0; i < 3; i++) l.take('k', 3, 1000);
    expect(l.take('k', 3, 1000).allowed).toBe(false);
    c.advance(1001);
    expect(l.take('k', 3, 1000).allowed).toBe(true);
  });

  it('peek records nothing; record counts; reset clears', () => {
    const l = new SlidingWindowLimiter(clock().now);
    for (let i = 0; i < 10; i++) expect(l.peek('k', 1, 1000).allowed).toBe(true);
    l.record('k', 1000);
    expect(l.peek('k', 1, 1000).allowed).toBe(false);
    l.reset('k');
    expect(l.peek('k', 1, 1000).allowed).toBe(true);
  });

  it('keeps keys apart', () => {
    const l = new SlidingWindowLimiter(clock().now);
    l.take('a', 1, 1000);
    expect(l.take('a', 1, 1000).allowed).toBe(false);
    expect(l.take('b', 1, 1000).allowed).toBe(true);
  });
});

describe('LIMITS', () => {
  it('matches the design', () => {
    const m = (r: { max: number; windowMs: number }) => [r.max, r.windowMs / 60_000];
    expect(m(LIMITS.signInPairFailures)).toEqual([5, 15]);
    expect(m(LIMITS.signInIpFailures)).toEqual([30, 15]);
    expect(m(LIMITS.signUpIp)).toEqual([5, 60]);
    expect(m(LIMITS.signUpEmail)).toEqual([3, 60]);
    expect(LIMITS.resendEmailBurst).toEqual({ max: 1, windowMs: 30_000 });
    expect(m(LIMITS.resendEmailHour)).toEqual([5, 60]);
    expect(m(LIMITS.forgotEmail)).toEqual([3, 60]);
    expect(m(LIMITS.forgotIp)).toEqual([10, 60]);
    expect(m(LIMITS.codePairFailures)).toEqual([5, 15]);
  });
});
