import { z } from 'zod';

export const Id = z.string().uuid();
export type Id = z.infer<typeof Id>;

export const IsoDateTime = z.string().datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;
