import { createHash } from 'node:crypto';
import { normaliseWhitespace } from '@coach/types';

/** 64 hex characters: SHA-256 of the whitespace-normalised content. `kind` and `title` are not part of it. */
export function fingerprint(content: string): string {
  return createHash('sha256').update(normaliseWhitespace(content)).digest('hex');
}
