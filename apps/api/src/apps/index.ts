import type { Type } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { AdminModule } from './admin/admin.module';
import { AllowanceModule } from './allowance/allowance.module';
import { CoachModule } from './coach/coach.module';
import { CuratorModule } from './curator/curator.module';
import { GameplayModule } from './gameplay/gameplay.module';
import { PuzzlesModule } from './puzzles/puzzles.module';
import { ReviewModule } from './review/review.module';

/**
 * Feature modules of the API. Each subsystem adds one import and one array entry here
 * (contracts/internal-interfaces.md §5.7).
 */
export const FEATURE_MODULES: Type[] = [
  AccountsModule,
  AllowanceModule,
  PuzzlesModule,
  GameplayModule,
  AdminModule,
  CoachModule,
  CuratorModule,
  ReviewModule,
];
