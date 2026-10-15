import { createHash, randomBytes } from 'node:crypto';

/** 32 symbols, no I, L, O, or U. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SYMBOLS = 20;

/** 'GC-XXXXX-XXXXX-XXXXX-XXXXX': 100 bits from `crypto.randomBytes`. */
export function generateCode(): string {
  // 256 is a multiple of 32, so masking the low five bits is uniform.
  const bytes = randomBytes(SYMBOLS);
  let symbols = '';
  for (const byte of bytes) symbols += CODE_ALPHABET[byte & 31];
  return `GC-${symbols.slice(0, 5)}-${symbols.slice(5, 10)}-${symbols.slice(10, 15)}-${symbols.slice(15)}`;
}

/**
 * Upper-cases, strips spaces and hyphens and the optional `GC` prefix, reads `O` as `0` and `I`/`L` as `1`.
 * Returns the 20 symbols, or null when the input is not a code of this format.
 */
export function normalizeCode(input: string): string | null {
  let value = input
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  // The prefix is optional and `G` and `C` are code symbols too, so drop it only when 22 symbols remain.
  if (value.length === SYMBOLS + 2 && value.startsWith('GC')) value = value.slice(2);
  if (value.length !== SYMBOLS) return null;
  for (const char of value) if (!CODE_ALPHABET.includes(char)) return null;
  return value;
}

/** Lower-case hex SHA-256 of the normalised code. */
export function hashCode(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
