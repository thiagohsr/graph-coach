/**
 * Runs tasks with the same key one after the other (in this process). Two identical uploads sent together are therefore
 * handled one at a time: the second finds the first one's source and task and answers as a duplicate, without asking the
 * allowance for a run that would never start.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
