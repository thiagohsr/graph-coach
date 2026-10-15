import { Injectable } from '@nestjs/common';

/**
 * Serialises read-modify-write work per learner within one process (research R7). Not safe across several API
 * processes; accepted at demo scale.
 */
@Injectable()
export class LearnerLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(learnerId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(learnerId) ?? Promise.resolve();
    const result = previous.then(fn, fn);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(learnerId, tail);
    void tail.then(() => {
      if (this.tails.get(learnerId) === tail) this.tails.delete(learnerId);
    });
    return result;
  }

  /** For tests: the number of learners with work in flight. */
  get size(): number {
    return this.tails.size;
  }
}
