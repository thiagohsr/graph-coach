import { countWords } from '@coach/types';

/** Largest file the browser will read (the text is extracted locally and never uploaded). */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const TITLE_MAX = 200;
/** Fewer words than this in a PDF means there is no text layer (scanned images). */
export const MIN_PDF_WORDS = 20;

export const FILE_ACCEPT =
  '.pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';

export type FileFormat = 'pdf' | 'docx' | 'txt' | 'md';
export type SourceFormKind = 'text' | 'markdown';

export interface ExtractedFile {
  text: string;
  kind: SourceFormKind;
  title: string;
  words: number;
  fileName: string;
}

export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractError';
  }
}

export function detectFormat(file: { name: string; type?: string }): FileFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'md';
  if (name.endsWith('.txt')) return 'txt';
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'text/markdown') return 'md';
  if (file.type === 'text/plain') return 'txt';
  return null;
}

export function kindFor(format: FileFormat): SourceFormKind {
  return format === 'md' ? 'markdown' : 'text';
}

/** File name without extension, hyphens and underscores as spaces, cut to the title limit. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]*$/, '');
  return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX).trim();
}

/** Collapse runs of spaces, keep paragraph breaks (at most one blank line). */
export function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

/** Lazy loaders, replaced by vi.mock in tests. */
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

async function loadMammoth() {
  const mod = await import('mammoth/mammoth.browser');
  return (mod.default ?? mod) as {
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await task.promise;
  } catch (caught) {
    const name = (caught as { name?: string } | null)?.name;
    if (name === 'PasswordException') {
      throw new ExtractError(
        'This PDF is protected with a password. Remove the password or paste the text instead.',
      );
    }
    throw new ExtractError(
      'This file could not be read as a PDF. Try another file or paste the text.',
    );
  }
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let out = '';
      for (const item of content.items as PdfTextItem[]) {
        if (typeof item.str !== 'string') continue;
        out += item.str;
        out += item.hasEOL ? '\n' : ' ';
      }
      pages.push(out);
    }
    return normaliseWhitespace(pages.join('\n\n'));
  } catch {
    throw new ExtractError(
      'This file could not be read as a PDF. Try another file or paste the text.',
    );
  } finally {
    void task.destroy?.();
  }
}

async function extractDocx(file: File): Promise<string> {
  try {
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return normaliseWhitespace(result.value);
  } catch {
    throw new ExtractError(
      'This file could not be read as a Word document. Use a .docx file or paste the text.',
    );
  }
}

async function extractPlain(file: File): Promise<string> {
  const text = await file.text();
  if (text.includes('\u0000')) {
    throw new ExtractError('This file looks like binary data, not text. Choose a text file.');
  }
  return text.replace(/\r\n?/g, '\n');
}

/** Reads one file in the browser. Throws ExtractError with a message fit for the learner. */
export async function extractFile(file: File): Promise<ExtractedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ExtractError(
      'This file is larger than 15 MB. Choose a smaller file or paste part of the text.',
    );
  }
  const format = detectFormat(file);
  if (!format) {
    throw new ExtractError(
      'This file type is not supported. Choose a PDF, Word (.docx), text or Markdown file.',
    );
  }
  const text =
    format === 'pdf'
      ? await extractPdf(file)
      : format === 'docx'
        ? await extractDocx(file)
        : await extractPlain(file);
  const words = countWords(text);
  if (format === 'pdf' && words < MIN_PDF_WORDS) {
    throw new ExtractError(
      'This PDF seems to be scanned images, so there is no text to read. Paste the text instead, or use a PDF with selectable text.',
    );
  }
  return {
    text,
    kind: kindFor(format),
    title: titleFromFileName(file.name),
    words,
    fileName: file.name,
  };
}

/** First `maxWords` words of the text, keeping its line breaks. */
export function keepFirstWords(text: string, maxWords: number): string {
  const re = /\S+/g;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    count += 1;
    if (count === maxWords) return text.slice(0, match.index + match[0].length);
  }
  return text;
}
