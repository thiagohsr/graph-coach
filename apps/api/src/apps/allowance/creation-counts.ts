import { Inject, Injectable } from '@nestjs/common';
import { GraphKit, creationCountsQuery } from '@coach/graph-kit';
import { CLOCK, type Clock } from '../../common/clock';

export interface CreationCount {
  uploadsThisMonth: number;
  promptsThisMonth: number;
  creationsLastHour: number;
}

const HOUR_MS = 3_600_000;

/** First instant of the calendar month of `now`, in UTC. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** First instant of the next calendar month, in UTC (December rolls into January of the next year). */
export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export const ZERO_COUNT: Readonly<CreationCount> = Object.freeze({
  uploadsThisMonth: 0,
  promptsThisMonth: 0,
  creationsLastHour: 0,
});

/** Puzzle creations per user, read from the graph (`creation_counts`). Counts every role. */
@Injectable()
export class CreationCounts {
  constructor(
    @Inject(GraphKit) private readonly graph: GraphKit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async creationCounts(userId: string): Promise<CreationCount> {
    return (await this.creationCountsFor([userId])).get(userId) ?? { ...ZERO_COUNT };
  }

  /** Every requested id is present; users without creations (or without a Learner node) have zeros. */
  async creationCountsFor(userIds: string[]): Promise<Map<string, CreationCount>> {
    const result = new Map<string, CreationCount>(userIds.map((id) => [id, { ...ZERO_COUNT }]));
    if (userIds.length === 0) return result;

    const now = this.clock.now();
    const start = monthStart(now).getTime();
    const hourAgo = now.getTime() - HOUR_MS;
    const rows = await this.graph.run(creationCountsQuery, {
      userIds: [...new Set(userIds)],
      monthStart: start,
      hourAgo,
      since: Math.min(start, hourAgo),
    });
    for (const row of rows) {
      result.set(row.userId, {
        uploadsThisMonth: row.uploadsThisMonth,
        promptsThisMonth: row.promptsThisMonth,
        creationsLastHour: row.creationsLastHour,
      });
    }
    return result;
  }
}
