import { Inject, Injectable, Logger } from '@nestjs/common';
import { GraphKit } from '@coach/graph-kit';
import type { HealthDto } from '@coach/types';
import { DB, pingSql, type Db } from '../common/db/db.module';

const TIMEOUT_MS = 1_000;

/** Graph and SQL checks in parallel, 1 s each. Failure reasons are logged, never returned. */
@Injectable()
export class HealthService {
  private readonly logger = new Logger('Health');

  constructor(
    @Inject(GraphKit) private readonly graph: GraphKit,
    @Inject(DB) private readonly db: Db,
  ) {}

  async check(): Promise<HealthDto> {
    const [graph, sql] = await Promise.all([this.checkGraph(), this.checkSql()]);
    return { api: 'ok', graph, sql };
  }

  private async checkGraph(): Promise<'ok' | 'down'> {
    try {
      const result = await withTimeout(this.graph.health(), TIMEOUT_MS);
      if (result.status === 'ok') return 'ok';
      this.logger.warn(`Graph check failed: ${result.error ?? 'no reason given'}`);
    } catch (error) {
      this.logger.warn(`Graph check failed: ${reason(error)}`);
    }
    return 'down';
  }

  private async checkSql(): Promise<'ok' | 'down'> {
    try {
      if (await withTimeout(pingSql(this.db, TIMEOUT_MS), TIMEOUT_MS + 200)) return 'ok';
      this.logger.warn('SQL check failed: no answer within 1 s');
    } catch (error) {
      this.logger.warn(`SQL check failed: ${reason(error)}`);
    }
    return 'down';
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
