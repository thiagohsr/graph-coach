import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { buildDecisionPath, createCoachQueries, runCoach, type CoachQueries, type DecisionRow } from '@coach/agents/coach';
import type { ChatProvider, EmbeddingsProvider, UsageTracer } from '@coach/agents/llm';
import { GraphKit, toIso, type QueryParams } from '@coach/graph-kit';
import type { CoachFlag } from '@coach/types';
import { assertOwner, callerParams } from '../../common/access/access';
import type { AuthUser } from '../../common/auth/auth-user';
import { CLOCK, type Clock } from '../../common/clock';
import { ConflictError, NotFoundError, UnavailableError } from '../../common/errors/app-error';
import { CHAT_PROVIDER, EMBEDDINGS_PROVIDER, USAGE_TRACER } from '../../common/llm/llm.tokens';
import { SettingsService } from '../../common/settings/settings.service';
import { AllowanceService } from '../allowance/allowance.service';
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
    @Optional() @Inject(CHAT_PROVIDER) private readonly chat?: ChatProvider,
    @Optional() @Inject(EMBEDDINGS_PROVIDER) private readonly embeddings?: EmbeddingsProvider,
    @Optional() @Inject(AllowanceService) private readonly allowance?: Pick<AllowanceService, 'check'>,
  ) {}

  private logEvent(event: string, data: object): void {
    this.logger.log(`${event} ${JSON.stringify(data)}`);
  }

  private queries(): CoachQueries {
    return createCoachQueries((name, params) => this.graph.query(name, params as QueryParams));
  }

  /**
   * Runs the graph, then reads the decision back with get_decision (one code path for fresh and reused decisions).
   * The Coach acts for the caller only. A `goal` is resolved to concepts by the graph (embeddings provider); the
   * creation allowance for `prompt` is only read (`check`), never consumed, to decide whether a cover task may be requested.
   */
  async recommend(user: AuthUser, goal?: string): Promise<RecommendationDto> {
    const learnerId = user.id;
    const settings = await loadCoachSettings(this.settings);
    const queries = this.queries();
    const allowance = this.allowance;
    let result;
    try {
      result = await runCoach(
        {
          queries,
          settings,
          newId: randomUUID,
          ...(this.tracer ? { tracer: this.tracer } : {}),
          ...(this.chat ? { chatModel: this.chat } : {}),
          ...(this.embeddings ? { embeddings: this.embeddings } : {}),
          ...(allowance ? { coverageAllowance: () => allowance.check(user, 'prompt') } : {}),
          logger: { warn: (event, data) => this.logger.warn(`${event} ${JSON.stringify(data ?? {})}`) },
        },
        { learnerId, goalText: goal ?? null, now: this.clock.now().getTime() },
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
    return toRecommendation(row, result.outcome === 'reused', await this.coverageGapOf(row));
  }

  /**
   * `coverageGap.concepts` (present exactly when the flag `coverage_gap` is): the target when the recommended puzzle does
   * not cover it, plus the concepts of the cover task (`coverage_requested`) or the goal concepts no playable puzzle
   * covers now (`coverage_not_requested`: there is no task to read them from). Decisions without a goal show the target.
   */
  private async coverageGapOf(row: DecisionRow): Promise<ConceptRef[] | undefined> {
    const flags = flagsOf(row);
    if (!flags.includes('coverage_gap')) return undefined;
    const target = targetOf(row);
    const requested = flags.includes('coverage_requested');
    if (!requested && !flags.includes('coverage_not_requested')) return target ? [target] : undefined;

    const goalConcepts = row.goalConcepts;
    const checkIds = [...new Set([...(target ? [target.conceptId] : []), ...goalConcepts.map((c) => c.conceptId)])];
    const covered = new Set<string>();
    let puzzleCoversTarget = false;
    if (checkIds.length > 0) {
      const rows = await this.queries().playablePuzzlesCovering({
        userId: row.ownerId,
        targetIds: checkIds,
        recentSince: this.clock.now().getTime(),
        limit: 100,
      });
      for (const r of rows) for (const id of r.coveredTargetIds) covered.add(id);
      puzzleCoversTarget =
        target !== null && rows.some((r) => r.puzzleId === row.puzzleId && r.coveredTargetIds.includes(target.conceptId));
    }
    const extras = requested ? row.coverageConcepts : goalConcepts.filter((c) => !covered.has(c.conceptId));
    const concepts: ConceptRef[] = [];
    for (const c of [...(target && !puzzleCoversTarget ? [target] : []), ...extras]) {
      if (!concepts.some((known) => known.conceptId === c.conceptId)) concepts.push({ conceptId: c.conceptId, name: c.name });
    }
    if (concepts.length === 0 && target) concepts.push(target);
    return concepts.length > 0 ? concepts : undefined;
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

type ConceptRef = { conceptId: string; name: string };

function targetOf(row: DecisionRow): ConceptRef | null {
  return row.targetConceptId && row.targetName ? { conceptId: row.targetConceptId, name: row.targetName } : null;
}

function flagsOf(row: DecisionRow): CoachFlag[] {
  return row.flags.filter((flag): flag is CoachFlag => CoachFlagSchema.safeParse(flag).success);
}

function toRecommendation(row: DecisionRow, reused: boolean, gap: ConceptRef[] | undefined): RecommendationDto {
  const flags = flagsOf(row);
  const target = targetOf(row);
  return RecommendationDto.parse({
    decisionId: row.id,
    puzzle: row.puzzleId && row.puzzleName ? { id: row.puzzleId, name: row.puzzleName } : null,
    target,
    summary: row.summary,
    alternatives: row.alternatives,
    flags,
    ...(flags.includes('coverage_gap') && gap ? { coverageGap: { concepts: gap } } : {}),
    ...(row.coverageTaskId ? { coverageTaskId: row.coverageTaskId } : {}),
    reused,
  });
}
