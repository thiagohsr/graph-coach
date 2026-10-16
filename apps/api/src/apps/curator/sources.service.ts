import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  fingerprint,
  ingestTaskId,
  sourceId as makeSourceId,
  taskIdFor,
} from '@coach/agents/curator';
import { toIso } from '@coach/graph-kit';
import {
  PromptBrief,
  guard,
  guardBrief,
  type PromptCreateRequest,
  type UploadCreateRequest,
  type SourceDetailDto,
  type SourceCreateRequest,
  type SourceCreateResponse,
  type SourceSummaryDto,
} from '@coach/types';
import { assertCanReadSource, callerParams } from '../../common/access/access';
import type { AuthUser } from '../../common/auth/auth-user';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainInvalidError } from '../../common/errors/app-error';
import { SettingsService } from '../../common/settings/settings.service';
import { AllowanceService } from '../allowance/allowance.service';
import { CuratorGraph } from './curator.graph-port';
import type { SourceListRow } from './curator.rows';
import { KeyedLock } from './keyed-lock';
import type { SourceDetailRow } from './source-detail.row';
import { RunOrchestrator } from './run-orchestrator.service';

export interface CreateSourceResult {
  /** 202 for a new run, 200 for a duplicate upload. */
  status: 200 | 202;
  body: SourceCreateResponse;
}

@Injectable()
export class SourcesService {
  private readonly lock = new KeyedLock();

  constructor(
    @Inject(CuratorGraph) private readonly graph: CuratorGraph,
    @Inject(RunOrchestrator) private readonly orchestrator: RunOrchestrator,
    @Inject(AllowanceService) private readonly allowance: AllowanceService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * POST /sources, in the order of the HTTP contract. No model or embedding call happens here:
   * 1. the guard (422 SOURCE_REJECTED), which consumes nothing;
   * 2. the duplicate lookup for this owner (200 at once, with no allowance asked: the answer is the same with no
   *    allowance left or while creation is paused);
   * 3. AllowanceService.assertAllowed (503 CREATION_PAUSED, 429 CREATION_LIMIT_REACHED), then begin;
   * 4. create_source, create_task, grant.confirm() (grant.refund() if a write fails), and start the run.
   */
  async create(user: AuthUser, body: SourceCreateRequest): Promise<CreateSourceResult> {
    return body.kind === 'prompt' ? this.createPrompt(user, body) : this.createUpload(user, body);
  }

  /**
   * A prompt creation: the brief guard (no model call), then the allowance of kind `prompt`, then a new source and a
   * `generate` task. Prompts are not deduplicated: every submission gets a random source id, a new run, and its own
   * allowance.
   */
  private async createPrompt(
    user: AuthUser,
    body: PromptCreateRequest,
  ): Promise<CreateSourceResult> {
    const verdict = guardBrief(body.brief);
    if (!verdict.ok) {
      throw new DomainInvalidError('SOURCE_REJECTED', 'The brief was not accepted', {
        reasons: verdict.reasons.map((reason) => reason.code),
        issues: verdict.reasons.map((reason) => ({
          path: reason.path,
          message: reason.message,
          code: reason.code,
        })),
      });
    }

    await this.allowance.assertAllowed(user, 'prompt');
    const grant = await this.allowance.begin(user, 'prompt');
    const sourceId = randomUUID();
    const taskId = taskIdFor('generate', sourceId);
    try {
      const now = this.clock.now().getTime();
      const created = await this.graph.createSource({
        id: sourceId,
        ownerId: user.id,
        title: body.title,
        kind: 'prompt',
        fingerprint: null,
        content: null,
        brief: JSON.stringify(body.brief),
        now,
      });
      if (!created) throw new Error('The source could not be written: the owner does not exist');
      if (
        !(await this.graph.createTask({
          id: taskId,
          kind: 'generate',
          requesterId: user.id,
          sourceId,
          now,
        }))
      ) {
        throw new Error('The task could not be written');
      }
      grant.confirm();
    } catch (error) {
      await grant.refund();
      throw error;
    }

    this.orchestrator.start(taskId);
    return { status: 202, body: { taskId, sourceId } };
  }

  private async createUpload(
    user: AuthUser,
    body: UploadCreateRequest,
  ): Promise<CreateSourceResult> {
    const maxWords = await this.settings.get('sourceMaxWords');
    const verdict = guard({ kind: body.kind, content: body.content }, { maxWords });
    if (!verdict.ok) {
      throw new DomainInvalidError('SOURCE_REJECTED', 'The text was not accepted', {
        reasons: verdict.reasons.map((reason) => reason.code),
        issues: verdict.reasons.map((reason) => ({
          path: reason.code === 'unsupported_kind' ? 'kind' : 'content',
          message: reason.message,
          code: reason.code,
        })),
      });
    }

    const print = fingerprint(body.content);
    // Identical submissions from one owner are handled one at a time, so exactly one source and one task come out.
    return this.lock.run(`${user.id}:${print}`, async () => {
      const existing = await this.graph.sourceByFingerprint(user.id, print);
      if (existing?.taskId) {
        return { status: 200, body: { duplicateOf: existing.sourceId, taskId: existing.taskId } };
      }

      await this.allowance.assertAllowed(user, 'upload');
      const grant = await this.allowance.begin(user, 'upload');

      // A source left without a task by an earlier request that died is completed, not duplicated.
      const sourceId = existing?.sourceId ?? makeSourceId(user.id, print);
      const taskId = ingestTaskId(sourceId);
      try {
        const now = this.clock.now().getTime();
        const created = await this.graph.createSource({
          id: sourceId,
          ownerId: user.id,
          title: body.title,
          kind: body.kind,
          fingerprint: print,
          content: body.content,
          brief: null,
          now,
        });
        if (!created) throw new Error('The source could not be written: the owner does not exist');
        if (
          !(await this.graph.createTask({
            id: taskId,
            kind: 'ingest',
            requesterId: user.id,
            sourceId,
            now,
          }))
        ) {
          throw new Error('The task could not be written');
        }
        grant.confirm();
      } catch (error) {
        await grant.refund();
        throw error;
      }

      this.orchestrator.start(taskId);
      return { status: 202, body: { taskId, sourceId } };
    });
  }

  /** The sources the caller owns or was given. Neither the text nor the brief is in this list. */
  async list(user: AuthUser): Promise<SourceSummaryDto[]> {
    const rows = await this.graph.listSources(callerParams(user).userId);
    return rows.map(toSummary);
  }

  /** The source with its text (upload) or brief (prompt). 404 for anyone who fails canReadSource, whatever the role. */
  async get(user: AuthUser, id: string): Promise<SourceDetailDto> {
    const row = await this.graph.getSource(id, callerParams(user).userId);
    assertCanReadSource(
      user,
      row
        ? {
            ownerId: row.access === 'owner' ? user.id : null,
            sharedWithCaller: row.access === 'shared',
          }
        : null,
    );
    return toDetail(row!);
  }
}

function toDetail(row: SourceDetailRow): SourceDetailDto {
  const brief = row.kind === 'prompt' ? parseBrief(row.brief) : undefined;
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    origin: row.kind === 'prompt' ? 'prompt' : 'upload',
    createdAt: toIso(row.createdAt),
    access: row.access,
    ownerName: row.ownerName,
    ...(row.kind !== 'prompt' && row.content !== null ? { content: row.content } : {}),
    ...(brief !== undefined ? { brief } : {}),
    ...(row.puzzleId !== null ? { puzzleId: row.puzzleId } : {}),
  };
}

function parseBrief(raw: string | null): SourceDetailDto['brief'] | undefined {
  if (raw === null) return undefined;
  try {
    const parsed = PromptBrief.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function toSummary(row: SourceListRow): SourceSummaryDto {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    origin: row.kind === 'prompt' ? 'prompt' : 'upload',
    chunkCount: row.chunkCount,
    conceptCount: row.conceptCount,
    ...(row.puzzleId !== null ? { puzzleId: row.puzzleId } : {}),
    ...(row.access === 'owner' && row.taskId !== null ? { taskId: row.taskId } : {}),
    ...(row.access === 'owner' && row.taskStatus !== null ? { taskStatus: row.taskStatus } : {}),
    createdAt: toIso(row.createdAt),
    access: row.access,
    ownerName: row.ownerName,
  };
}
