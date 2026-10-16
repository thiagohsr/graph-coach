import { Inject, Injectable } from '@nestjs/common';
import { toIso } from '@coach/graph-kit';
import type { ShareDto, ShareRequest } from '@coach/types';
import { callerParams } from '../../../common/access/access';
import type { AuthUser } from '../../../common/auth/auth-user';
import { CLOCK, type Clock } from '../../../common/clock';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../../common/errors/app-error';
import { RateLimiter } from '../../../common/rate-limit/rate-limiter';
import { UserDirectory } from '../../accounts/user-directory';
import { ReviewGraph } from '../review.graph';

/** Share attempts per owner per hour; every attempt counts, successful or not (FR-U29). */
export const SHARE_ATTEMPTS_PER_HOUR = 20;

/**
 * Sharing a published puzzle with a user chosen by e-mail address. The address is resolved to an id by `UserDirectory`;
 * only ids go to the graph and the address reaches no logger. Names and addresses come back from the directory, in
 * responses to the puzzle's owner only.
 */
@Injectable()
export class SharesService {
  constructor(
    @Inject(ReviewGraph) private readonly graph: ReviewGraph,
    @Inject(UserDirectory) private readonly directory: UserDirectory,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(user: AuthUser, puzzleId: string): Promise<ShareDto[]> {
    const rows = await this.graph.listShares(puzzleId, callerParams(user).userId);
    if (rows.length === 0) throw new NotFoundError('Puzzle');
    const shares = rows.filter((row) => row.targetId !== null && row.at !== null);
    const contacts = await this.directory.contacts(shares.map((row) => row.targetId!));
    return shares.flatMap((row) => {
      const contact = contacts.get(row.targetId!);
      if (!contact) return [];
      return [
        {
          userId: row.targetId!,
          name: contact.name,
          email: contact.email,
          withSource: row.withSource ?? false,
          sharedAt: toIso(row.at!),
        },
      ];
    });
  }

  async share(user: AuthUser, puzzleId: string, body: ShareRequest): Promise<ShareDto> {
    await this.limiter.enforce(
      {
        name: 'shares',
        windows: [{ name: 'hour', limit: SHARE_ATTEMPTS_PER_HOUR, windowMs: 3_600_000 }],
      },
      user.id,
    );

    // Ownership and state first, so that a non-owner learns nothing about addresses.
    const rows = await this.graph.listShares(puzzleId, callerParams(user).userId);
    const [first] = rows;
    if (!first) throw new NotFoundError('Puzzle');
    if (first.status === 'draft') throw draftConflict();

    const targetId = await this.directory.findIdByEmail(body.email);
    if (targetId === null) throw emailIssue('Nobody has signed in with that address yet.');
    if (targetId === user.id) throw emailIssue('You cannot share a puzzle with yourself.');

    const result = await this.graph.sharePuzzle({
      puzzleId,
      userId: callerParams(user).userId,
      targetId,
      withSource: body.withSource,
      now: this.clock.now().getTime(),
    });
    if (!result) throw new NotFoundError('Puzzle');
    if (!result.shared) {
      if (result.status === 'draft') throw draftConflict();
      if (!result.targetFound) throw emailIssue('Nobody has signed in with that address yet.');
      if (body.withSource && !result.hasSource) {
        throw new ValidationFailedError([
          { path: 'withSource', message: 'This puzzle has no source to share.' },
        ]);
      }
      throw emailIssue('You cannot share a puzzle with yourself.');
    }

    const contact = (await this.directory.contacts([targetId])).get(targetId);
    return {
      userId: targetId,
      name: contact?.name ?? '',
      email: contact?.email ?? body.email,
      withSource: result.withSource ?? body.withSource,
      sharedAt: toIso(result.at ?? this.clock.now().getTime()),
    };
  }

  /** 204 whether or not a share existed; 404 only when the caller does not own the puzzle. */
  async revoke(user: AuthUser, puzzleId: string, targetId: string): Promise<void> {
    const removed = await this.graph.unsharePuzzle(puzzleId, callerParams(user).userId, targetId);
    if (removed === null) throw new NotFoundError('Puzzle');
  }
}

function draftConflict(): ConflictError {
  return new ConflictError('The puzzle is not published', {
    details: { status: 'draft' } as never,
  });
}

function emailIssue(message: string): ValidationFailedError {
  return new ValidationFailedError([{ path: 'email', message }]);
}
