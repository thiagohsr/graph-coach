import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AdminComputeProvider,
  AdminHookContext,
  AdminHookResult,
  AdminUpdateProvider,
} from '@coach/admin-kit';
import type { Role, UserStatus } from '@coach/types';
import { ConflictError, ValidationFailedError } from '../../common/errors/app-error';
import { AccountsService } from '../accounts/accounts.service';
import { CodesService } from '../allowance/codes.service';
import { CreationCounts } from '../allowance/creation-counts';
import { UsageTotals } from '../allowance/usage-totals';

type FieldErrors = Record<string, string>;

/**
 * Providers named by declarations (compute and update), bound here because they need injected services. The admin
 * service refuses to start when a declared name is missing from these maps.
 */
@Injectable()
export class AdminProviders {
  private readonly logger = new Logger('AdminProviders');

  readonly compute: Readonly<Record<string, AdminComputeProvider>>;
  readonly update: Readonly<Record<string, AdminUpdateProvider>>;

  constructor(
    @Inject(CreationCounts) private readonly counts: CreationCounts,
    @Inject(UsageTotals) private readonly usage: UsageTotals,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(CodesService) private readonly codes: CodesService,
  ) {
    this.compute = { 'user.creations': (record) => this.userCreations(record.id) };
    this.update = {
      'user.account': (ctx) => this.userAccount(ctx),
      'code.disable': (ctx) => this.disableCode(ctx),
    };
  }

  // ─── Compute ───────────────────────────────────────────────────────────────

  /** Each service fails on its own: the other's fields are still filled. A failed one gives null (unavailable, not 0). */
  private async userCreations(id: string) {
    const values: Record<string, number | null> = {
      uploadsThisMonth: null,
      promptsThisMonth: null,
      creationsLastHour: null,
      tokensThisMonth: null,
    };
    try {
      const count = (await this.counts.creationCountsFor([id])).get(id);
      values.uploadsThisMonth = count?.uploadsThisMonth ?? 0;
      values.promptsThisMonth = count?.promptsThisMonth ?? 0;
      values.creationsLastHour = count?.creationsLastHour ?? 0;
    } catch (error) {
      this.logger.warn(`Creation counts unavailable: ${errorName(error)}`);
    }
    try {
      const usage = (await this.usage.usageTotalsFor([id])).get(id);
      values.tokensThisMonth = usage
        ? usage.inputTokens + usage.outputTokens + usage.embeddingTokens
        : 0;
    } catch (error) {
      this.logger.warn(`Usage totals unavailable: ${errorName(error)}`);
    }
    return values;
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  /**
   * Checks every rule of AccountsService before any write, then writes through it. A refusal becomes a field error with
   * the service's message; NotFoundError passes.
   */
  private async userAccount(ctx: AdminHookContext): Promise<AdminHookResult> {
    const { changes, actor, id } = ctx;
    const status = changes.status as UserStatus | undefined;
    const role = changes.role as Role | undefined;
    const fields: FieldErrors = {};

    if (status !== undefined) {
      await refusal(fields, 'status', () => this.accounts.assertCanChangeStatus(actor, id, status));
    }
    if (role !== undefined) {
      await refusal(fields, 'role', () => this.accounts.assertCanChangeRole(actor, id, role));
    }
    if (Object.keys(fields).length > 0) return { fields };

    const runs: { source?: number; prompt?: number } = {};
    if (changes.bonusSourceRuns !== undefined) runs.source = changes.bonusSourceRuns as number;
    if (changes.bonusPromptRuns !== undefined) runs.prompt = changes.bonusPromptRuns as number;
    if (Object.keys(runs).length > 0) {
      try {
        await this.accounts.setBonusRuns(actor, id, runs);
      } catch (error) {
        if (!(error instanceof ValidationFailedError)) throw error;
        const details = error.details as { issues: { path: string; message: string }[] };
        for (const issue of details.issues) {
          fields[issue.path === 'source' ? 'bonusSourceRuns' : 'bonusPromptRuns'] = issue.message;
        }
        return { fields };
      }
    }
    if (status !== undefined) await this.accounts.setStatus(actor, id, status);
    if (role !== undefined) await this.accounts.setRole(actor, id, role);
  }

  /** Disabling is one-way: CodesService has no call that enables a code again. */
  private async disableCode(ctx: AdminHookContext): Promise<AdminHookResult> {
    if (ctx.changes.disabled === true) {
      await this.codes.disable(ctx.id);
      return;
    }
    if (ctx.changes.disabled === false && ctx.current.disabled === true) {
      return { fields: { disabled: 'A disabled code cannot be re-enabled; create a new code' } };
    }
  }
}

async function refusal(
  fields: FieldErrors,
  field: string,
  check: () => Promise<void>,
): Promise<void> {
  try {
    await check();
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    fields[field] = error.message;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'error';
}
