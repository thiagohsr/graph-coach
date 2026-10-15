import { Global, Module } from '@nestjs/common';
import { DB, type Db } from '../../common/db/db.module';
import { ALLOWANCE_STORE, DrizzleAllowanceStore } from './allowance-store';
import { AllowanceController } from './allowance.controller';
import { AllowanceService } from './allowance.service';
import { CodesService } from './codes.service';
import { CreationCounts } from './creation-counts';
import { UsageTotals } from './usage-totals';

/** Global: puzzle creation (005) injects `AllowanceService`; the admin (006) injects the counts and totals. */
@Global()
@Module({
  controllers: [AllowanceController],
  providers: [
    { provide: ALLOWANCE_STORE, inject: [DB], useFactory: (db: Db) => new DrizzleAllowanceStore(db) },
    AllowanceService,
    CodesService,
    CreationCounts,
    UsageTotals,
  ],
  exports: [AllowanceService, CodesService, CreationCounts, UsageTotals],
})
export class AllowanceModule {}
