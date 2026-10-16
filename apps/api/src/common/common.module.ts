import { Global, Module } from '@nestjs/common';
import { CLOCK, SystemClock } from './clock';
import { DB, type Db } from './db/db.module';
import { RateLimiter } from './rate-limit/rate-limiter';
import { SETTINGS_TABLE, SettingsService, createSettingsTable } from './settings/settings.service';

/** Global. Shared providers every feature module can inject: `CLOCK`, `RateLimiter`, and `SettingsService`. */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    RateLimiter,
    { provide: SETTINGS_TABLE, inject: [DB], useFactory: (db: Db) => createSettingsTable(db) },
    SettingsService,
  ],
  exports: [CLOCK, RateLimiter, SettingsService],
})
export class CommonModule {}
