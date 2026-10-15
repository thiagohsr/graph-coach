import { describe, expect, it } from 'vitest';
import { LearnerLock } from './learner-lock';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('LearnerLock', () => {
  it('runs calls for the same learner strictly one after the other', async () => {
    const lock = new LearnerLock();
    const log: string[] = [];
    const job = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
    };
    await Promise.all([lock.run('u', job('a')), lock.run('u', job('b'))]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('lets different learners overlap', async () => {
    const lock = new LearnerLock();
    const log: string[] = [];
    const job = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
    };
    await Promise.all([lock.run('u1', job('a')), lock.run('u2', job('b'))]);
    expect(log.slice(0, 2).sort()).toEqual(['a:start', 'b:start']);
  });

  it('a rejected fn does not block the next call', async () => {
    const lock = new LearnerLock();
    const first = lock.run('u', async () => {
      throw new Error('boom');
    });
    const second = lock.run('u', async () => 'ok');
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
  });

  it('keeps no map entry after the last call settles', async () => {
    const lock = new LearnerLock();
    await lock.run('u', async () => 1);
    await lock.run('u', async () => 2).catch(() => undefined);
    await tick();
    expect(lock.size).toBe(0);
  });
});
