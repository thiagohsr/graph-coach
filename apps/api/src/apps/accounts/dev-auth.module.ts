import { Module } from '@nestjs/common';
import { DevAuthController } from './dev-auth.controller';

/** Imported by `AppModule.forRoot('dev')` only. `AccountsService` and `UserDirectory` come from the global AccountsModule. */
@Module({ controllers: [DevAuthController] })
export class DevAuthModule {}
