import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDocument = vi.fn();
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/worker.js' }));
const extractRawText = vi.fn();
vi.mock('mammoth/mammoth.browser', () => ({ default: { extractRawText } }));

import {
  ExtractError,
  MAX_FILE_BYTES,
  extractFile,
  keepFirstWords,
  titleFromFileName,
} from './extract-text';

const WORDS = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');

function file(name: string, content: BlobPart, type = '') {
  return new File([content], name, { type });
}

function pdfWith(pages: string[][]) {
  return {
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (n: number) => ({
        getTextContent: async () => ({ items: pages[n - 1]!.map((str) => ({ str })) }),
      }),
      destroy: vi.fn(),
    }),
  };
}

beforeEach(() => {
  getDocument.mockReset();
  extractRawText.mockReset();
});

describe('extractFile', () => {
  it('reads .txt as kind text with a title from the file name', async () => {
    const r = await extractFile(file('database_notes-week-1.txt', WORDS));
    expect(r).toMatchObject({ kind: 'text', title: 'database notes week 1', words: 60 });
    expect(r.text).toBe(WORDS);
  });

  it('reads .md and .markdown as kind markdown', async () => {
    expect((await extractFile(file('a.md', '# Hi\n\ntext'))).kind).toBe('markdown');
    expect((await extractFile(file('a.markdown', 'text'))).kind).toBe('markdown');
  });

  it('rejects binary content', async () => {
    await expect(extractFile(file('a.txt', 'ab\u0000cd'))).rejects.toThrow(/binary/);
  });

  it('rejects files over 15 MB and unsupported types', async () => {
    const big = file('big.txt', 'x');
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
    await expect(extractFile(big)).rejects.toThrow(/15 MB/);
    await expect(extractFile(file('a.png', 'x'))).rejects.toThrow(/not supported/);
  });

  it('extracts PDF text page by page', async () => {
    getDocument.mockReturnValue(
      pdfWith([
        [WORDS.slice(0, 100), 'end   of one'],
        ['page', 'two'],
      ]),
    );
    const r = await extractFile(file('Paper.pdf', 'x', 'application/pdf'));
    expect(r.kind).toBe('text');
    expect(r.title).toBe('Paper');
    expect(r.text).toContain('end of one');
    expect(r.text).toContain('\n\npage two');
  });

  it('explains a scanned PDF', async () => {
    getDocument.mockReturnValue(pdfWith([['  ']]));
    await expect(extractFile(file('scan.pdf', 'x'))).rejects.toThrow(/scanned images/);
  });

  it('explains an encrypted or invalid PDF', async () => {
    getDocument.mockReturnValueOnce({
      promise: Promise.reject(Object.assign(new Error('pw'), { name: 'PasswordException' })),
    });
    await expect(extractFile(file('a.pdf', 'x'))).rejects.toThrow(/password/);
    getDocument.mockReturnValueOnce({ promise: Promise.reject(new Error('bad')) });
    await expect(extractFile(file('b.pdf', 'x'))).rejects.toBeInstanceOf(ExtractError);
  });

  it('extracts DOCX raw text and explains an invalid file', async () => {
    extractRawText.mockResolvedValueOnce({ value: `${WORDS}\n\n\n\nmore` });
    const r = await extractFile(file('Notes.docx', 'x'));
    expect(r).toMatchObject({ kind: 'text', title: 'Notes', words: 61 });
    expect(r.text).toContain('\n\nmore');
    extractRawText.mockRejectedValueOnce(new Error('zip'));
    await expect(extractFile(file('bad.docx', 'x'))).rejects.toThrow(/Word document/);
  });
});

describe('helpers', () => {
  it('cuts long titles to 200 characters', () => {
    expect(titleFromFileName(`${'a'.repeat(300)}.txt`)).toHaveLength(200);
  });
  it('keeps the first words', () => {
    expect(keepFirstWords('one two\nthree four', 3)).toBe('one two\nthree');
    expect(keepFirstWords('one two', 5)).toBe('one two');
  });
});
