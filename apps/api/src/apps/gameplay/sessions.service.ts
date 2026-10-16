import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { GraphKit } from '@coach/graph-kit';
import type { StartSessionResponse, SubmitRequest, SubmitResult } from '@coach/types';
import { callerParams } from '../../common/access/access';
import type { AuthUser } from '../../common/auth/auth-user';
import { CLOCK, type Clock } from '../../common/clock';
import type { AnswerKey, GradedBlank } from './gameplay.dto';
import {
  invalidAnswers,
  puzzleNotFound,
  sessionAlreadySubmitted,
  sessionNotFound,
  sessionNotSubmitted,
} from './gameplay.errors';
import {
  AnswerKeyRow,
  GroundingRow,
  RecordRow,
  SessionIdRow,
  SessionRow,
} from './gameplay.queries';
import { grade, validateSubmission } from './grading';
import { LearnerLock } from './learner-lock';
import { MasteryService } from './mastery.service';
import { buildResult } from './result';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger('SessionsService');

  constructor(
    @Inject(GraphKit) private readonly graph: GraphKit,
    @Inject(MasteryService) private readonly mastery: MasteryService,
    @Inject(LearnerLock) private readonly lock: LearnerLock,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The only place canPlay is checked for a session (inside create_session). */
  async start(user: AuthUser, puzzleId: string, now?: number): Promise<StartSessionResponse> {
    const rows = await this.graph.query(
      'create_session',
      {
        sessionId: randomUUID(),
        puzzleId,
        now: now ?? this.clock.now().getTime(),
        ...callerParams(user),
      },
      { schema: SessionIdRow },
    );
    const row = rows[0];
    if (!row) throw puzzleNotFound();
    return { sessionId: row.sessionId };
  }

  async submit(
    user: AuthUser,
    sessionId: string,
    body: SubmitRequest,
    now?: number,
  ): Promise<SubmitResult> {
    return this.lock.run(user.id, async () => {
      const session = await this.loadSession(user.id, sessionId);
      if (session.submittedAt !== null) throw sessionAlreadySubmitted();

      const key = await this.loadKey(session.puzzleId);
      const issues = validateSubmission(key, body.answers);
      if (issues.length > 0) throw invalidAnswers(issues);

      const { score, maxScore, blanks } = grade(key, body.answers);
      const changes = await this.mastery.plan(user.id, blanks, key);
      const submittedAt = now ?? this.clock.now().getTime();

      const rows = await this.graph.query(
        'record_answers',
        {
          sessionId,
          learnerId: user.id,
          answers: blanks.map((b) => ({
            questionId: b.questionId,
            blank: b.blank,
            word: b.word,
            correct: b.correct,
          })),
          mastery: changes.map((c) => ({
            conceptId: c.conceptId,
            before: c.before,
            after: c.after,
            attempts: c.attempts,
          })),
          score,
          maxScore,
          now: submittedAt,
        },
        { schema: RecordRow },
      );
      const written = rows[0];
      if (!written) throw sessionAlreadySubmitted();
      if (written.answersWritten !== blanks.length) {
        this.logger.error(
          `record_answers wrote ${written.answersWritten} answers for ${blanks.length} blanks (session ${sessionId})`,
        );
      }

      return buildResult({
        session: {
          sessionId,
          puzzleId: session.puzzleId,
          puzzleName: session.puzzleName,
          puzzleOrigin: session.puzzleOrigin,
          submittedAt,
          score,
          maxScore,
        },
        key,
        blanks,
        changes,
        passages: await this.loadPassages(user.id, sessionId),
      });
    });
  }

  /** Read-only: the stored result of a submitted session. */
  async getResult(user: AuthUser, sessionId: string): Promise<SubmitResult> {
    const session = await this.loadSession(user.id, sessionId);
    if (session.submittedAt === null) throw sessionNotSubmitted();

    const key = await this.loadKey(session.puzzleId);
    const entries = new Map(key.map((entry) => [entry.questionId, entry]));
    const blanks: GradedBlank[] = session.answers
      .map((answer) => ({
        questionId: answer.questionId,
        order: answer.order,
        blank: answer.blank,
        word: answer.word,
        expected: entries.get(answer.questionId)?.answers[answer.blank] ?? '',
        correct: answer.correct,
      }))
      .sort((a, b) => a.order - b.order || a.blank - b.blank);

    return buildResult({
      session: {
        sessionId: session.sessionId,
        puzzleId: session.puzzleId,
        puzzleName: session.puzzleName,
        puzzleOrigin: session.puzzleOrigin,
        submittedAt: session.submittedAt,
        score: session.score ?? 0,
        maxScore: session.maxScore ?? 0,
      },
      key,
      blanks,
      changes: session.masteryChanges,
      passages: await this.loadPassages(user.id, sessionId),
    });
  }

  /**
   * Passages the caller may read now (canReadSource inside question_grounding). A failure never fails the result:
   * the review is shown without passages.
   */
  private async loadPassages(
    userId: string,
    sessionId: string,
  ): Promise<Map<string, { chunkId: string; sourceId: string; text: string }>> {
    try {
      const rows = await this.graph.query(
        'question_grounding',
        { sessionId, userId },
        { schema: GroundingRow },
      );
      return new Map(
        rows.map((r) => [r.questionId, { chunkId: r.chunkId, sourceId: r.sourceId, text: r.text }]),
      );
    } catch {
      this.logger.warn(`grounding_unavailable session=${sessionId}`);
      return new Map();
    }
  }

  /** Zero rows means unknown or another learner's session: both are 404. */
  private async loadSession(learnerId: string, sessionId: string): Promise<SessionRow> {
    const rows = await this.graph.query(
      'get_session',
      { sessionId, learnerId },
      { schema: SessionRow },
    );
    const row = rows[0];
    if (!row) throw sessionNotFound();
    return row;
  }

  private async loadKey(puzzleId: string): Promise<AnswerKey> {
    return this.graph.query('puzzle_answer_key', { puzzleId }, { schema: AnswerKeyRow });
  }
}
