import { Inject, Injectable } from '@nestjs/common';
import { ZERO_USAGE, type Usage } from '@coach/agents/llm';
import { GraphKit, usageTotalsQuery } from '@coach/graph-kit';
import { CLOCK, type Clock } from '../../common/clock';
import { monthStart } from './creation-counts';

/** Model calls and tokens per user for the current calendar month (UTC), for the admin. Tokens and calls only. */
@Injectable()
export class UsageTotals {
  constructor(
    @Inject(GraphKit) private readonly graph: GraphKit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async usageTotals(userId: string): Promise<Usage> {
    return (await this.usageTotalsFor([userId])).get(userId) ?? ZERO_USAGE;
  }

  /** Every requested id is present; users without usage have ZERO_USAGE. */
  async usageTotalsFor(userIds: string[]): Promise<Map<string, Usage>> {
    const result = new Map<string, Usage>(userIds.map((id) => [id, ZERO_USAGE]));
    if (userIds.length === 0) return result;

    const rows = await this.graph.run(usageTotalsQuery, {
      userIds: [...new Set(userIds)],
      monthStart: monthStart(this.clock.now()).getTime(),
    });
    for (const row of rows) {
      result.set(row.userId, {
        modelCalls: row.modelCalls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        embeddingTokens: row.embeddingTokens,
      });
    }
    return result;
  }
}
