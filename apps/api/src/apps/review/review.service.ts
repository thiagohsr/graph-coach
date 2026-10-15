import { Inject, Injectable } from '@nestjs/common';
import {
  validateDraft,
  type DraftQuestionDto,
  type DraftUpdateRequest,
  type DraftViolation,
  type ReviewOutcome,
} from '@coach/types';
import type { AuthUser } from '../../common/auth/auth-user';
import { callerParams } from '../../common/access/access';
import { CLOCK, type Clock } from '../../common/clock';
import { ConflictError, DomainInvalidError, NotFoundError } from '../../common/errors/app-error';
import { PublishService } from './publish.service';
import { ReviewGraph, type DraftRow } from './review.graph';

type DecisionStatus = 'draft' | 'approved' | 'rejected';

@Injectable()
export class ReviewService {
  constructor(
    @Inject(ReviewGraph) private readonly graph: ReviewGraph,
    @Inject(PublishService) private readonly publish: PublishService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The drafts of puzzles the caller owns, by status (default draft). A `taskId` that does not exist or that the
   * caller did not request answers 404, whatever the caller's role.
   */
  async list(
    user: AuthUser,
    query: { status?: DecisionStatus; taskId?: string },
  ): Promise<DraftQuestionDto[]> {
    const { userId } = callerParams(user);
    if (query.taskId !== undefined && !(await this.graph.requestedTask(query.taskId, userId))) {
      throw new NotFoundError('Task');
    }
    const rows = await this.graph.listDrafts(userId, {
      status: query.status ?? 'draft',
      taskId: query.taskId ?? null,
    });
    return rows.map(toDto);
  }

  async edit(user: AuthUser, questionId: string, patch: DraftUpdateRequest): Promise<DraftQuestionDto> {
    const draft = await this.loadOwned(user, questionId);
    const merged = {
      sentence: patch.sentence ?? draft.sentence,
      answers: patch.answers ?? draft.answers,
      distractors: patch.distractors ?? draft.distractors,
    };
    this.assertValid(draft, merged);
    const saved = await this.graph.updateDraft({
      questionId,
      userId: callerParams(user).userId,
      ...merged,
    });
    if (!saved) throw alreadyDecided('approved');
    return toDto({ ...draft, ...merged });
  }

  async approve(user: AuthUser, questionId: string): Promise<ReviewOutcome> {
    const draft = await this.loadOwned(user, questionId);
    this.assertValid(draft, draft);
    // An upload draft needs its passage, a prompt draft its brief; both need at least one concept.
    const missing: DraftViolation[] = [];
    if (draft.concepts.every((c) => c.slug === null)) {
      missing.push({ code: 'no_concept', path: 'concepts', message: 'The question tests no concept.' });
    }
    if (draft.origin === 'upload' && draft.chunkId === null) {
      missing.push({ code: 'answer_not_in_passage', path: 'answers', message: 'The question has no passage.' });
    }
    if (draft.origin === 'prompt' && !draft.hasBrief) {
      missing.push({ code: 'no_concept', path: 'concepts', message: 'The question has no brief.' });
    }
    if (missing.length > 0) throw invalid(missing);

    const done = await this.graph.approveQuestion(questionId, callerParams(user).userId, this.now());
    if (!done) throw alreadyDecided('approved');
    return this.publish.onDecision(draft, 'approved');
  }

  async reject(user: AuthUser, questionId: string, reason: string | undefined): Promise<ReviewOutcome> {
    const draft = await this.loadOwned(user, questionId);
    const done = await this.graph.rejectQuestion(
      questionId,
      callerParams(user).userId,
      reason !== undefined && reason !== '' ? reason : null,
      this.now(),
    );
    if (!done) throw alreadyDecided('rejected');
    return this.publish.onDecision(draft, 'rejected');
  }

  private now(): number {
    return this.clock.now().getTime();
  }

  /** The draft when the caller owns its puzzle (no row = 404 for every role), 409 when it was already decided. */
  private async loadOwned(user: AuthUser, questionId: string): Promise<DraftRow> {
    const [draft] = await this.graph.listDrafts(callerParams(user).userId, { questionId });
    if (!draft) throw new NotFoundError('Question');
    if (draft.status !== 'draft') throw alreadyDecided(draft.status);
    return draft;
  }

  private assertValid(
    draft: DraftRow,
    values: { sentence: string; answers: string[]; distractors: string[] },
  ): void {
    const slugs = draft.concepts.map((c) => c.slug).filter((s): s is string => s !== null);
    const verdict = validateDraft(
      { sentence: values.sentence, answers: values.answers, distractors: values.distractors, conceptSlugs: slugs },
      { chunkText: draft.origin === 'upload' ? draft.chunkText : null, allowedSlugs: new Set(slugs) },
    );
    if (!verdict.ok) throw invalid(verdict.violations);
  }
}

function alreadyDecided(status: string): ConflictError {
  return new ConflictError('This question was already decided', {
    code: 'ALREADY_DECIDED',
    details: { status } as never,
  });
}

function invalid(violations: DraftViolation[]): DomainInvalidError {
  return new DomainInvalidError('DRAFT_INVALID', 'The draft does not meet the rules', {
    reasons: [...new Set(violations.map((v) => v.code))],
    issues: violations.map((v) => ({ path: v.path, message: v.message, code: v.code })),
  });
}

function toDto(row: DraftRow): DraftQuestionDto {
  return {
    id: row.id,
    sentence: row.sentence,
    answers: row.answers,
    distractors: row.distractors,
    concepts: row.concepts
      .filter((c) => c.id !== null)
      .map((c) => ({ id: c.id!, name: c.name ?? c.slug ?? c.id! })),
    passage: row.origin === 'upload' && row.chunkId !== null && row.chunkText !== null
      ? { chunkId: row.chunkId, text: row.chunkText }
      : null,
    critique: parseCritique(row.critique),
    origin: row.origin,
    puzzleId: row.puzzleId,
    taskId: row.taskId,
  };
}

function parseCritique(raw: string | null): DraftQuestionDto['critique'] {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { verdict?: unknown; note?: unknown };
    if (parsed.verdict === 'pass' || parsed.verdict === 'rewrite' || parsed.verdict === 'reject') {
      return { verdict: parsed.verdict, note: typeof parsed.note === 'string' ? parsed.note : '' };
    }
  } catch {
    // An unreadable critique is shown as none.
  }
  return null;
}
