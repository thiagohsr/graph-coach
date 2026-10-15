import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { buildDecisionPath, createCoachQueries, runCoach, type CoachQueries, type DecisionRow } from '@coach/agents/coach';
import type { UsageTracer } from '@coach/agents/llm';
import { GraphKit, toIso, type QueryParams } from '@coach/graph-kit';
import type { CoachFlag } from '@coach/types';
import { assertOwner, callerParams } from '../../common/access/access';
import type { AuthUser } from '../../common/auth/auth-user';
import { CLOCK, type Clock } from '../../common/clock';
import { ConflictError, NotFoundError, UnavailableError } from '../../common/errors/app-error';
import { USAGE_TRACER } from '../../common/llm/llm.tokens';
import { SettingsService } from '../../common/settings/settings.service';
import {
  CoachFlag as CoachFlagSchema,
  DecisionDto,
  DecisionPathDto,
  RecommendationDto,
} from './coach.dto';
import { toApiError } from './coach.errors';
import { loadCoachSettings } from './coach.settings';

@Injectable()
export class CoachService {
  private readonly logger = new Logger('CoachService');

  constructor(
    @Inject(GraphKit) private readonly graph: GraphKit,
    @Inject(SettingsService) private readonly settings: Pick<SettingsService, 'getAll'>,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(USAGE_TRACER) private readonly tracer?: UsageTracer,
  ) {}

  private logEvent(event: string, data: object): void {
    this.logger.log(`${event} ${JSON.stringify(data)}`);
  }

  private queries(): CoachQueries {
    return createCoachQueries((name, params) => this.graph.query(name, params as QueryParams));
  }

  /**
   * Runs the graph, then reads the decision back with get_decision (one code path for fresh and reused decisions).
   * `goal` is validated by the controller and otherwise ignored until the goal stretch exists, so it does not
   * influence reuse either.
   */
  async recommend(learnerId: string, goal?: string): Promise<RecommendationDto> {
    void goal; // validated by the controller; resolved to concepts only by the goal stretch (not built)
    const settings = await loadCoachSettings(this.settings);
    const queries = this.queries();
    let result;
    try {
      result = await runCoach(
        {
          queries,
          settings,
          newId: randomUUID,
          ...(this.tracer ? { tracer: this.tracer } : {}),
          logger: { warn: (event, data) => this.logger.warn(`${event} ${JSON.stringify(data ?? {})}`) },
        },
        { learnerId, goalText: null, now: this.clock.now().getTime() },
      );
    } catch (error) {
      throw toApiError(error);
    }
    if (result.outcome === 'no_content' || result.decisionId === null) {
      this.logEvent('coach.no_content', { learnerId });
      throw new ConflictError('There is nothing playable for you yet', { code: 'NO_PLAYABLE_CONTENT' });
    }
    const row = await queries.getDecision({ decisionId: result.decisionId });
    if (!row) throw new UnavailableError('DECISION_NOT_RECORDED', 'The decision could not be read back');
    // Ids and flags only: never the summary, display names, or e-mail addresses.
    this.logEvent(result.outcome === 'reused' ? 'coach.reused' : 'coach.recommended', {
      learnerId,
      decisionId: row.id,
      puzzleId: row.puzzleId ?? null,
      targetConceptId: row.targetConceptId ?? null,
      flags: flagsOf(row),
      coverageTaskId: row.coverageTaskId ?? null,
    });
    return toRecommendation(row, result.outcome === 'reused');
  }

  async getDecision(user: AuthUser, decisionId: string): Promise<DecisionDto> {
    const row = await this.readDecision(user, decisionId);
    return DecisionDto.parse({
      id: row.id,
      kind: row.kind,
      summary: row.summary,
      createdAt: toIso(row.createdAt),
      puzzle: row.puzzleId && row.puzzleName ? { id: row.puzzleId, name: row.puzzleName } : null,
      target: targetOf(row),
      flags: flagsOf(row),
    });
  }

  /** `decision_path` runs with the decision's owner as the learner and the caller as the viewer (passages follow canReadSource). */
  async getDecisionPath(user: AuthUser, decisionId: string): Promise<DecisionPathDto> {
    const row = await this.readDecision(user, decisionId);
    const { traversalDepth } = await loadCoachSettings(this.settings);
    const rows = await this.queries().decisionPath({
      decisionId,
      learnerId: row.ownerId,
      ...callerParams(user),
      depth: traversalDepth,
    });
    return DecisionPathDto.parse(buildDecisionPath(rows));
  }

  /** 404 NOT_FOUND when the decision is missing, or the caller is neither its learner nor an admin. */
  private async readDecision(user: AuthUser, decisionId: string): Promise<DecisionRow> {
    const row = await this.queries().getDecision({ decisionId });
    if (!row) throw new NotFoundError('Decision');
    assertOwner(user, row.ownerId, 'Decision', { adminToo: true });
    return row;
  }
}

function targetOf(row: DecisionRow): { conceptId: string; name: string } | null {
  return row.targetConceptId && row.targetName ? { conceptId: row.targetConceptId, name: row.targetName } : null;
}

function flagsOf(row: DecisionRow): CoachFlag[] {
  return row.flags.filter((flag): flag is CoachFlag => CoachFlagSchema.safeParse(flag).success);
}

function toRecommendation(row: DecisionRow, reused: boolean): RecommendationDto {
  const flags = flagsOf(row);
  const target = targetOf(row);
  return RecommendationDto.parse({
    decisionId: row.id,
    puzzle: row.puzzleId && row.puzzleName ? { id: row.puzzleId, name: row.puzzleName } : null,
    target,
    summary: row.summary,
    alternatives: row.alternatives,
    flags,
    ...(flags.includes('coverage_gap') && target ? { coverageGap: { concepts: [target] } } : {}),
    ...(row.coverageTaskId ? { coverageTaskId: row.coverageTaskId } : {}),
    reused,
  });
}
