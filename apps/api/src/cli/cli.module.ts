import { Module } from '@nestjs/common';
import { AccountsModule } from '../apps/accounts/accounts.module';
import { AllowanceModule } from '../apps/allowance/allowance.module';
import { AuthModule } from '../common/auth/auth.module';
import { CommonModule } from '../common/common.module';
import { DbModule } from '../common/db/db.module';
import { GraphModule } from '../common/graph/graph.module';
import { ConfigModule } from '../config/config.module';
import { CLI_OUTPUT, CLI_PROMPT, consoleOutput, readlinePrompt } from './cli-support';
import {
  CreateCodeCommand,
  DisableCodeCommand,
  GrantRunsCommand,
  ListCodesCommand,
} from './codes.command';
import { MIGRATOR, MigrateCommand, drizzleMigrator } from './migrate.command';
import { ResetCommand } from './reset.command';
import { SeedCommand } from './seed.command';
import { SetupGraphCommand } from './setup-graph.command';
import {
  BlockUserCommand,
  GrantRoleCommand,
  ResetOnboardingCommand,
  UnblockUserCommand,
} from './users.command';

/**
 * The CLI application: configuration, the two stores, accounts, and the commands. No HTTP server, no providers, and no
 * embedding-dimension check (contracts/cli-and-config.md §1).
 */
@Module({
  imports: [
    ConfigModule,
    DbModule,
    GraphModule,
    CommonModule,
    AuthModule,
    AccountsModule,
    AllowanceModule,
  ],
  providers: [
    { provide: CLI_OUTPUT, useValue: consoleOutput },
    { provide: CLI_PROMPT, useValue: readlinePrompt },
    { provide: MIGRATOR, useValue: drizzleMigrator },
    MigrateCommand,
    SetupGraphCommand,
    SeedCommand,
    ResetCommand,
    GrantRoleCommand,
    BlockUserCommand,
    UnblockUserCommand,
    ResetOnboardingCommand,
    CreateCodeCommand,
    ListCodesCommand,
    DisableCodeCommand,
    GrantRunsCommand,
  ],
})
export class CliModule {}
