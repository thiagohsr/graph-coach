/** Keeps event timestamps per key. The limiter owns the semantics; the store only appends, lists, and forgets. */
export interface RateLimitStore {
  /** Appends a timestamp and drops those older than keepMs. */
  add(key: string, at: number, keepMs: number): Promise<void>;
  /** Timestamps not older than sinceMs before now, ascending. */
  list(key: string, now: number, sinceMs: number): Promise<number[]>;
  delete(key: string): Promise<void>;
}

/** Counters live in process memory and reset when the API restarts (contracts §5.4). */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly events = new Map<string, number[]>();

  async add(key: string, at: number, keepMs: number): Promise<void> {
    const list = this.events.get(key) ?? [];
    list.push(at);
    list.sort((a, b) => a - b);
    const keepFrom = at - keepMs;
    this.events.set(
      key,
      list.filter((t) => t > keepFrom),
    );
  }

  async list(key: string, now: number, sinceMs: number): Promise<number[]> {
    const list = this.events.get(key);
    if (!list) return [];
    const from = now - sinceMs;
    const kept = list.filter((t) => t > from);
    if (kept.length === 0) this.events.delete(key);
    else if (kept.length !== list.length) this.events.set(key, kept);
    return kept;
  }

  async delete(key: string): Promise<void> {
    this.events.delete(key);
  }
}
