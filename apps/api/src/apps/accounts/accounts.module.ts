import { Global, Module } from '@nestjs/common';
import { AccountsController, MeController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { UserDirectory } from './user-directory';

/** Global: every feature module can inject `AccountsService` and `UserDirectory` without importing this module. */
@Global()
@Module({
  controllers: [AccountsController, MeController],
  providers: [AccountsService, UserDirectory],
  exports: [AccountsService, UserDirectory],
})
export class AccountsModule {}
