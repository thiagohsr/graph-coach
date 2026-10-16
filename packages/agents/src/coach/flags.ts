// The flag list lives in @coach/types (`CoachFlag`). This file only re-exports the type for the package surface; it could
// not be deleted in the overnight run (rm is refused), so it is safe to delete together with its line in ./index.ts.
export type { CoachFlag } from '@coach/types';
