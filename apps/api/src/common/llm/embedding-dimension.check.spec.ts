import { describe, expect, it } from 'vitest';
import { REBUILD_COMMAND, checkEmbeddingDimension } from './embedding-dimension.check';

describe('checkEmbeddingDimension', () => {
  it('is ok when all three agree', () => {
    expect(checkEmbeddingDimension({ configured: 64, provider: 64, stored: 64 })).toEqual({
      status: 'ok',
    });
  });

  it('warns when the stored value is missing', () => {
    expect(checkEmbeddingDimension({ configured: 64, provider: 64, stored: null }).status).toBe(
      'warning',
    );
  });

  it('reports a stored value that differs, with both numbers and the rebuild command', () => {
    const result = checkEmbeddingDimension({ configured: 1536, provider: 1536, stored: 64 });
    expect(result.status).toBe('mismatch');
    if (result.status !== 'mismatch') return;
    expect(result.message).toContain('1536');
    expect(result.message).toContain('64');
    expect(result.message).toContain(REBUILD_COMMAND);
  });

  it('reports a provider whose dimension differs from the configuration', () => {
    const result = checkEmbeddingDimension({ configured: 1536, provider: 768, stored: 1536 });
    expect(result.status).toBe('mismatch');
    if (result.status !== 'mismatch') return;
    expect(result.message).toContain('768');
    expect(result.message).toContain('1536');
  });
});
