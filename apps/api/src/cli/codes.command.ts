import { Inject } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { AccountsService } from '../apps/accounts/accounts.service';
import { UserDirectory } from '../apps/accounts/user-directory';
import { CODE_ALPHABET, generateCode } from '../apps/allowance/code-format';
import { CodesService, type AccessCodeMeta } from '../apps/allowance/codes.service';
import { CLI_OUTPUT, CliError, parseCount, type CliOutput } from './cli-support';
import { requireUserId } from './users.command';

const VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;
const SYMBOL = `[${CODE_ALPHABET}]`;
/** The generated format only: optional `GC` prefix, then 20 symbols of the alphabet (hyphens between groups optional). */
const GENERATED_FORMAT = new RegExp(`^(?:GC-?)?${SYMBOL}{5}(?:-?${SYMBOL}{5}){3}$`, 'i');

function describeCode(meta: AccessCodeMeta): string {
  return (
    `id ${meta.id} label "${meta.label}" source ${meta.sourceRuns} prompt ${meta.promptRuns} ` +
    `lift-days ${meta.liftDays} max ${meta.maxRedemptions}`
  );
}

export interface CreateCodeOptions {
  label?: string;
  source?: number;
  prompt?: number;
  liftDays?: number;
  max?: number;
  expires?: Date;
  fromEnv?: string;
  generateOnly?: boolean;
}

@Command({
  name: 'create-code',
  description: 'Create an access code and store only its hash (the code is printed once, or read from --from-env)',
})
export class CreateCodeCommand extends CommandRunner {
  constructor(
    @Inject(CodesService) private readonly codes: CodesService,
    @Inject(CLI_OUTPUT) private readonly out: CliOutput,
  ) {
    super();
  }

  @Option({ flags: '--label <text>', description: 'Name for the operator (required unless --generate-only)' })
  parseLabel(value: string): string {
    return value;
  }

  @Option({ flags: '--source <n>', description: 'Bonus upload runs granted (default 0)' })
  parseSource(value: string): number {
    return parseCount('--source', value, 1000);
  }

  @Option({ flags: '--prompt <n>', description: 'Bonus prompt runs granted (default 0)' })
  parsePrompt(value: string): number {
    return parseCount('--prompt', value, 1000);
  }

  @Option({ flags: '--lift-days <n>', description: 'Days the hourly limit is lifted (default 0)' })
  parseLiftDays(value: string): number {
    return parseCount('--lift-days', value, 365);
  }

  @Option({ flags: '--max <n>', description: 'Maximum redemptions (default 1)' })
  parseMax(value: string): number {
    return parseCount('--max', value, 100_000);
  }

  @Option({ flags: '--expires <iso>', description: 'Expiry as an ISO date-time' })
  parseExpires(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new CliError('--expires: not a valid ISO date-time');
    return date;
  }

  @Option({ flags: '--from-env <variable>', description: 'Read the code from this environment variable' })
  parseFromEnv(value: string): string {
    return value;
  }

  @Option({ flags: '--generate-only', description: 'Print a new code and store nothing' })
  parseGenerateOnly(): boolean {
    return true;
  }

  async run(_args: string[], options: CreateCodeOptions = {}): Promise<void> {
    if (options.generateOnly) {
      if (options.fromEnv !== undefined) throw new CliError('--from-env and --generate-only cannot be combined');
      this.out.line(generateCode());
      return;
    }
    if (!options.label) throw new CliError('--label is required');

    const input = {
      label: options.label,
      sourceRuns: options.source ?? 0,
      promptRuns: options.prompt ?? 0,
      liftDays: options.liftDays ?? 0,
      maxRedemptions: options.max ?? 1,
      ...(options.expires ? { expiresAt: options.expires } : {}),
    };

    if (options.fromEnv !== undefined) {
      const name = options.fromEnv;
      if (!VARIABLE_NAME.test(name)) throw new CliError('--from-env: the variable name must match [A-Z][A-Z0-9_]*');
      const value = (process.env[name] ?? '').trim();
      if (!GENERATED_FORMAT.test(value)) throw new CliError(`ENV ${name}: not a valid access code`);
      const meta = await this.codes.createFromValue(input, value);
      this.out.line(describeCode(meta));
      return;
    }

    const { code, meta } = await this.codes.create(input);
    this.out.line(code);
    this.out.line(describeCode(meta));
    this.out.line('The code is shown once and cannot be recovered; create a new one if it is lost.');
  }
}

@Command({ name: 'list-codes', description: 'List the access codes (never the code or its hash)' })
export class ListCodesCommand extends CommandRunner {
  constructor(
    @Inject(CodesService) private readonly codes: CodesService,
    @Inject(CLI_OUTPUT) private readonly out: CliOutput,
  ) {
    super();
  }

  async run(): Promise<void> {
    const all = await this.codes.list();
    for (const meta of all) {
      this.out.line(
        `${meta.id} "${meta.label}" source=${meta.sourceRuns} prompt=${meta.promptRuns} lift-days=${meta.liftDays} ` +
          `redeemed=${meta.redeemedCount}/${meta.maxRedemptions} expires=${meta.expiresAt?.toISOString() ?? 'never'} ` +
          `disabled=${meta.disabled}`,
      );
    }
    this.out.line(`${all.length} code${all.length === 1 ? '' : 's'}`);
  }
}

@Command({ name: 'disable-code', arguments: '<id>', description: 'Disable an access code' })
export class DisableCodeCommand extends CommandRunner {
  constructor(
    @Inject(CodesService) private readonly codes: CodesService,
    @Inject(CLI_OUTPUT) private readonly out: CliOutput,
  ) {
    super();
  }

  async run(params: string[]): Promise<void> {
    const meta = await this.codes.disable(params[0] ?? '');
    this.out.line(`code ${meta.id}: disabled`);
  }
}

@Command({ name: 'grant-runs', arguments: '<email>', description: 'Add bonus runs to one account' })
export class GrantRunsCommand extends CommandRunner {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(UserDirectory) private readonly directory: UserDirectory,
    @Inject(CLI_OUTPUT) private readonly out: CliOutput,
  ) {
    super();
  }

  @Option({ flags: '--source <n>', description: 'Upload runs to add' })
  parseSource(value: string): number {
    return parseCount('--source', value, 1000);
  }

  @Option({ flags: '--prompt <n>', description: 'Prompt runs to add' })
  parsePrompt(value: string): number {
    return parseCount('--prompt', value, 1000);
  }

  async run(params: string[], options: { source?: number; prompt?: number } = {}): Promise<void> {
    if (!(options.source && options.source > 0) && !(options.prompt && options.prompt > 0)) {
      throw new CliError('Give --source and/or --prompt, at least one greater than 0');
    }
    const id = await requireUserId(this.directory, params[0]);
    const balances = await this.accounts.grantRuns(id, {
      ...(options.source !== undefined ? { source: options.source } : {}),
      ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
    });
    this.out.line(
      `user ${id}: bonus source runs ${balances.bonusSourceRuns}, bonus prompt runs ${balances.bonusPromptRuns}`,
    );
  }
}
