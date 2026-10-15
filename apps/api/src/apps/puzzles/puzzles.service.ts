import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PlayPuzzleDto, PuzzleOrigin, PuzzleSummaryDto } from '@coach/types';
import { GraphKit } from '@coach/graph-kit';
import { callerParams } from '../../common/access/access';
import type { AuthUser } from '../../common/auth/auth-user';
import { NotFoundError } from '../../common/errors/app-error';
import { buildWordBank } from './word-bank';

const ListRow = z.object({
  id: z.string(),
  name: z.string(),
  visibility: z.enum(['private', 'public']),
  origin: PuzzleOrigin,
  access: z.enum(['owner', 'shared', 'public']),
  ownerName: z.string().nullable(),
  sourceShared: z.boolean(),
  sourceId: z.string().nullable(),
  questionCount: z.number().int(),
  concepts: z.array(z.object({ id: z.string(), name: z.string() })),
});

const PlayRow = z.object({
  id: z.string(),
  name: z.string(),
  origin: PuzzleOrigin,
  questions: z.array(z.object({ id: z.string(), order: z.number(), sentence: z.string(), blanks: z.number() })),
  words: z.array(z.string()),
});

@Injectable()
export class PuzzlesService {
  constructor(@Inject(GraphKit) private readonly graph: GraphKit) {}

  /** Puzzles the caller may play. No role is passed: staff get no extra access. */
  async list(user: AuthUser): Promise<PuzzleSummaryDto[]> {
    const rows = await this.graph.query('list_puzzles', callerParams(user), { schema: ListRow });
    return rows.map(({ sourceId, ownerName, ...row }) =>
      PuzzleSummaryDto.parse({
        ...row,
        ownerName: ownerName ?? '',
        ...(sourceId !== null && row.sourceShared ? { sourceId } : {}),
      }),
    );
  }

  /** The answer-free play payload with a freshly shuffled word bank. */
  async play(user: AuthUser, puzzleId: string): Promise<PlayPuzzleDto> {
    const rows = await this.graph.query('play_puzzle', { puzzleId, ...callerParams(user) }, { schema: PlayRow });
    const row = rows[0];
    if (!row) throw new NotFoundError('Puzzle');
    return PlayPuzzleDto.parse({
      id: row.id,
      name: row.name,
      origin: row.origin,
      questions: row.questions,
      wordBank: buildWordBank(row.words),
    });
  }
}
