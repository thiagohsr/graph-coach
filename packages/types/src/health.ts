import { z } from 'zod';

export const StoreState = z.enum(['ok', 'down']);
export type StoreState = z.infer<typeof StoreState>;

export const HealthDto = z.object({ api: z.literal('ok'), graph: StoreState, sql: StoreState });
export type HealthDto = z.infer<typeof HealthDto>;
