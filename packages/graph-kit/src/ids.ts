import { createHash, randomUUID } from 'node:crypto';

/** SHA-256 of the parts joined with ':', first 32 hex characters, formatted 8-4-4-4-12. Same input, same id. */
export function deterministicId(...parts: string[]): string {
  const hex = createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function newId(): string {
  return randomUUID();
}

export function toEpochMs(value: Date | string | number): number {
  const ms =
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw new RangeError(`Not a valid time: ${String(value)}`);
  return ms;
}

export function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
