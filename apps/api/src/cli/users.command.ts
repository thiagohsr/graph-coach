import { Inject } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { AccountsService } from '../apps/accounts/accounts.service';
import { UserDirectory } from '../apps/accounts/user-directory';
import { USER_ROLES } from '../apps/accounts/user.model';
import { CLI_OUTPUT, CliError, type CliOutput } from './cli-support';

/** The same lookup for every user command: any account, whether or not it has signed in. */
export async function requireUserId(
  directory: UserDirectory,
  email: string | undefined,
): Promise<string> {
  const id = email ? await directory.findIdByEmail(email, { signedInOnly: false }) : null;
  if (!id) throw new CliError('No account with that e-mail address');
  return id;
}

@Command({
  name: 'grant-role',
  arguments: '<email> <role>',
  description: 'Set the role (learner, reviewer, admin) of the account with that e-mail address',
})
export class GrantRoleCommand extends CommandRunner {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(UserDirectory) private readonly directory: UserDirectory,
    @Inject(CLI_OUTPUT) private readonly out: CliOutput,
  ) {
    super();
  }

  async run(params: string[]): Promise<void> {
    const [email, role] = params;
    const allowed = USER_ROLES as readonly string[];
    if (!role || !allowed.includes(role)) {
      throw new CliError(`Role must be one of ${USER_ROLES.join(', ')}`);
    }
    const id = await requireUserId(this.directory, email);
    await this.accounts.setRole(null, id, role as (typeof USER_ROLES)[number]);
    this.out.line(`user ${id}: role is now ${role}`);
  }
}

@Command({
  name: 'block-user',
  arguments: '<email>',
  description: 'Block the account with that e-mail address',
})
export class BlockUserCommand extends CommandRunner {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(UserDirectory) private readonly directory: UserDirectory,
    @Inject(CLI_OUTPUT) private readonly out: CliOutput,
  ) {
    super();
  }

  async run(params: string[]): Promise<void> {
    const id = await requireUserId(this.directory, params[0]);
    await this.accounts.setStatus(null, id, 'blocked');
    this.out.line(`user ${id}: blocked`);
  }
}

@Command({
  name: 'unblock-user',
  arguments: '<email>',
  description: 'Unblock the account with that e-mail address',
})
export class UnblockUserCommand extends CommandRunner {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(UserDirectory) private readonly directory: UserDirectory,
    @Inject(CLI_OUTPUT) private readonly out: CliOutput,
  ) {
    super();
  }

  async run(params: string[]): Promise<void> {
    const id = await requireUserId(this.directory, params[0]);
    await this.accounts.setStatus(null, id, 'active');
    this.out.line(`user ${id}: active`);
  }
}
