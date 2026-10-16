// Curator pipeline schemas, event payloads, text helpers, and the request-time guard (spec 005).
// Everything here is pure and browser-safe: no Node-only import. The API, the agents package, and the web forms share it.
import { z } from 'zod';
import { IsoDateTime } from './common';

// ─── Shared enums ────────────────────────────────────────────────────────────

/** How a source was submitted. `prompt` is a creation from a brief (added to the request union by a later phase). */
export const SourceKind = z.enum(['text', 'markdown', 'url', 'prompt']);
export type SourceKind = z.infer<typeof SourceKind>;

export const UploadKind = z.enum(['text', 'markdown', 'url']);
export type UploadKind = z.infer<typeof UploadKind>;

/** How a source, puzzle, draft, or question was made (FR-U36). */
export const Origin = z.enum(['upload', 'prompt']);
export type Origin = z.infer<typeof Origin>;

export const TaskStatus = z.enum(['queued', 'in_progress', 'awaiting_review', 'done', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskResult = z.enum(['ok', 'nothing_usable', 'below_minimum']);
export type TaskResult = z.infer<typeof TaskResult>;

export const TaskKind = z.enum(['ingest', 'generate', 'cover']);
export type TaskKind = z.infer<typeof TaskKind>;

/** Upload runs use chunk..publish; prompt runs use outline, draftQuestions, critique, refine, validate, publish. */
export const StepName = z.enum([
  'chunk',
  'embed',
  'extractConcepts',
  'linkPrerequisites',
  'outline',
  'draftQuestions',
  'critique',
  'refine',
  'validate',
  'topUp',
  'publish',
]);
export type StepName = z.infer<typeof StepName>;

export const StepStatus = z.enum(['active', 'complete', 'error']);
export type StepStatus = z.infer<typeof StepStatus>;

export const Usage = z.object({
  modelCalls: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  embeddingTokens: z.number().int(),
});
export type Usage = z.infer<typeof Usage>;

// ─── Notices ─────────────────────────────────────────────────────────────────

/** Shown on every add-source form (FR-U30). */
export const UPLOAD_NOTICE =
  'Only upload material you have the right to use. This site is a demonstration: content may be removed and the site may be reset at any time.';

/** Shown wherever a prompt-made item appears (FR-U36). */
export const PROMPT_ORIGIN_NOTICE = 'Generated from a prompt, not checked against a source';

// ─── Requests and responses ──────────────────────────────────────────────────

export const UploadCreateRequest = z
  .object({
    title: z.string().trim().min(1).max(200),
    kind: UploadKind,
    /** Hard transport cap; the guard applies the word limits. */
    content: z.string().max(200_000),
  })
  .strict();
export type UploadCreateRequest = z.infer<typeof UploadCreateRequest>;

/** What a learner asks for when there is no source text (FR-U31). Bounds are the ones of data-model §5. */
export const PromptBrief = z
  .object({
    subject: z.string().trim().min(3).max(120),
    focus: z.string().trim().max(300).optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    sentences: z.number().int().min(3).max(10),
  })
  .strict();
export type PromptBrief = z.infer<typeof PromptBrief>;

export const PromptCreateRequest = z
  .object({
    title: z.string().trim().min(1).max(200),
    kind: z.literal('prompt'),
    brief: PromptBrief,
  })
  .strict();
export type PromptCreateRequest = z.infer<typeof PromptCreateRequest>;

/** An upload or a prompt, told apart by `kind`. */
export const SourceCreateRequest = z.discriminatedUnion('kind', [
  UploadCreateRequest.extend({ kind: z.literal('text') }).strict(),
  UploadCreateRequest.extend({ kind: z.literal('markdown') }).strict(),
  UploadCreateRequest.extend({ kind: z.literal('url') }).strict(),
  PromptCreateRequest,
]);
export type SourceCreateRequest = z.infer<typeof SourceCreateRequest>;

export const SourceCreateResponse = z.union([
  z.object({ taskId: z.string(), sourceId: z.string() }),
  z.object({ duplicateOf: z.string(), taskId: z.string().optional() }),
]);
export type SourceCreateResponse = z.infer<typeof SourceCreateResponse>;

export const SourceSummaryDto = z.object({
  id: z.string(),
  title: z.string(),
  kind: SourceKind,
  origin: Origin,
  chunkCount: z.number().int(),
  conceptCount: z.number().int(),
  puzzleId: z.string().optional(),
  taskId: z.string().optional(),
  taskStatus: TaskStatus.optional(),
  createdAt: IsoDateTime,
  access: z.enum(['owner', 'shared']),
  ownerName: z.string(),
});
export type SourceSummaryDto = z.infer<typeof SourceSummaryDto>;

export const SourceDetailDto = z.object({
  id: z.string(),
  title: z.string(),
  kind: SourceKind,
  origin: Origin,
  createdAt: IsoDateTime,
  access: z.enum(['owner', 'shared']),
  ownerName: z.string(),
  /** Uploads only. */
  content: z.string().optional(),
  /** Prompts only. */
  brief: PromptBrief.optional(),
  puzzleId: z.string().optional(),
});
export type SourceDetailDto = z.infer<typeof SourceDetailDto>;

export const StepDto = z.object({
  /** Same keys as StepEventPayload, so a snapshot and the stream merge. */
  stepId: z.string(),
  order: z.number().int(),
  node: StepName,
  status: StepStatus,
  log: z.string().optional(),
  /** Present once the step is complete or in error. */
  usage: Usage.optional(),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.optional(),
});
export type StepDto = z.infer<typeof StepDto>;

export const TaskDto = z.object({
  id: z.string(),
  kind: TaskKind,
  status: TaskStatus,
  result: TaskResult.nullable(),
  error: z.string().optional(),
  /** Totals of the steps; zeros before the first model call. */
  usage: Usage,
  steps: z.array(StepDto),
  produced: z.object({
    concepts: z.number().int(),
    questions: z.number().int(),
    puzzleId: z.string().optional(),
  }),
  sourceId: z.string().optional(),
  lastCompletedStep: StepName.optional(),
});
export type TaskDto = z.infer<typeof TaskDto>;

export const StepEventPayload = z.object({
  stepId: z.string(),
  order: z.number().int(),
  attempt: z.number().int(),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.optional(),
  /** Live events only; not stored. */
  counts: z.record(z.number()).optional(),
  /** On the event that completes or fails a step. */
  usage: Usage.optional(),
});
export type StepEventPayload = z.infer<typeof StepEventPayload>;

export const TaskEventPayload = z.object({
  taskId: z.string(),
  taskStatus: TaskStatus,
  result: TaskResult.nullable(),
  lastCompletedStep: StepName.nullable(),
  error: z.string().nullable(),
});
export type TaskEventPayload = z.infer<typeof TaskEventPayload>;

// ─── Guard types ─────────────────────────────────────────────────────────────

export const GuardReasonCode = z.enum([
  'too_short',
  'too_long',
  'low_diversity',
  'mostly_markup',
  'repeated_content',
  'unsupported_kind',
  'brief_too_short',
  'brief_too_long',
  'brief_no_letters',
  'brief_not_a_topic',
  'brief_sentences_out_of_range',
]);
export type GuardReasonCode = z.infer<typeof GuardReasonCode>;

export const GuardReason = z.object({
  code: GuardReasonCode,
  message: z.string(),
  measured: z.number().optional(),
  threshold: z.number().optional(),
});
export type GuardReason = z.infer<typeof GuardReason>;

export interface GuardMetrics {
  words: number;
  distinctChars: number;
  dominantCharShare: number;
  letterRatio: number;
  markupRatio: number;
  repeatedSentenceRatio: number;
  uniqueWordRatio: number;
}

export interface GuardResult {
  ok: boolean;
  reasons: GuardReason[];
  metrics: GuardMetrics;
}

export interface GuardConfig {
  minWords: number;
  maxWords: number;
  minDistinctChars: number;
  maxDominantCharShare: number;
  minLetterRatio: number;
  maxMarkupRatio: number;
  maxRepeatedSentenceRatio: number;
  minUniqueWordRatio: number;
}

// ─── Text helpers ────────────────────────────────────────────────────────────

/**
 * CRLF and CR become LF, every run of Unicode whitespace becomes one space, the ends are trimmed. Nothing else changes
 * (no case folding, no punctuation or Unicode normalisation). The fingerprint is a hash of this.
 */
export function normaliseWhitespace(content: string): string {
  return content.replace(/\r\n?/g, '\n').replace(/\s+/gu, ' ').trim();
}

/**
 * Plain text for chunking and measuring. `text` is returned as it is. For `markdown` the markers go (heading hashes,
 * list bullets, quote marks, emphasis, code fences and backticks, link and image syntax, table pipes) and the words stay.
 */
export function toPlainText(kind: 'text' | 'markdown', content: string): string {
  const text = content.replace(/\r\n?/g, '\n');
  if (kind === 'text') return text;
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    let line = rawLine;
    if (/^\s*(```|~~~)/.test(line)) continue; // fence lines; the code between them is kept
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue; // horizontal rule
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-') && line.includes('|')) continue; // table separator
    line = line.replace(/^\s{0,3}#{1,6}\s+/, '');
    line = line.replace(/^\s*>+\s?/, '');
    line = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
    if (/^\s*\|/.test(line)) line = line.replace(/\|/g, ' ');
    line = line.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    line = line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    // Blank markers (___) are not emphasis: hide them while emphasis is removed.
    line = line.replace(/_{3,}/g, (run) => `\u0001${run.length}\u0002`);
    line = line.replace(/(\*\*|__)(.+?)\1/g, '$2');
    line = line.replace(/(?<![\w*])([*_])(?=\S)(.+?)(?<=\S)\1(?![\w*])/g, '$2');
    line = line.replace(/\u0001(\d+)\u0002/g, (_m, n: string) => '_'.repeat(Number(n)));
    line = line.replace(/`+/g, '');
    out.push(line);
  }
  return out.join('\n');
}

const SENTENCE_BOUNDARY = /(?<=[.!?]["'”’)\]]?)\s+(?=[\p{Lu}\p{N}"'“‘(\[])/u;

/** Sentences in reading order. A blank line always ends a sentence; otherwise `.`, `!`, or `?` followed by a capital, digit, or quote. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const flat = paragraph.replace(/\s+/gu, ' ').trim();
    if (flat === '') continue;
    for (const part of flat.split(SENTENCE_BOUNDARY)) {
      const sentence = part.trim();
      if (sentence !== '') sentences.push(sentence);
    }
  }
  return sentences;
}

// ─── Guard ───────────────────────────────────────────────────────────────────

export const GUARD_DEFAULTS: Readonly<GuardConfig> = Object.freeze({
  minWords: 80,
  maxWords: 10_000,
  minDistinctChars: 12,
  maxDominantCharShare: 0.35,
  minLetterRatio: 0.6,
  maxMarkupRatio: 0.3,
  maxRepeatedSentenceRatio: 0.4,
  minUniqueWordRatio: 0.1,
});

const WORD_CHAR = /[\p{L}\p{N}]/u;
const UNIQUE_WORD_WINDOW = 2000;
const MIN_SENTENCES_FOR_REPEAT_CHECK = 5;

/** Tokens separated by whitespace that contain at least one letter or digit. */
export function countWords(content: string): number {
  let count = 0;
  for (const token of content.split(/\s+/u)) if (token !== '' && WORD_CHAR.test(token)) count += 1;
  return count;
}

const MARKUP_PATTERN =
  /<\/?[A-Za-z!][^>]*>|&(?:#\d+|#x[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);|(?:https?:\/\/|www\.)\S+/g;

function nonSpaceLength(text: string): number {
  return text.replace(/\s+/gu, '').length;
}

/** All measurements the guard uses. Markup is measured on the raw content, everything else on the plain text. */
export function measureText(kind: 'text' | 'markdown', content: string): GuardMetrics {
  const plain = toPlainText(kind, content);
  const compact = Array.from(plain.replace(/\s+/gu, '').toLowerCase());
  const total = compact.length;

  const frequency = new Map<string, number>();
  let letters = 0;
  for (const ch of compact) {
    frequency.set(ch, (frequency.get(ch) ?? 0) + 1);
    if (/\p{L}/u.test(ch)) letters += 1;
  }
  let dominant = 0;
  for (const n of frequency.values()) if (n > dominant) dominant = n;

  const rawLength = nonSpaceLength(content);
  let markup = 0;
  for (const match of content.matchAll(MARKUP_PATTERN)) markup += nonSpaceLength(match[0]);

  const sentences = splitSentences(plain).map((s) => s.toLowerCase());
  const uniqueSentences = new Set(sentences).size;
  const repeatedSentenceRatio =
    sentences.length >= MIN_SENTENCES_FOR_REPEAT_CHECK ? 1 - uniqueSentences / sentences.length : 0;

  const tokens = plain
    .toLowerCase()
    .split(/\s+/u)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((t) => t !== '');
  const window = tokens.slice(0, UNIQUE_WORD_WINDOW);
  const uniqueWordRatio = window.length === 0 ? 1 : new Set(window).size / window.length;

  return {
    words: countWords(plain),
    distinctChars: frequency.size,
    dominantCharShare: total === 0 ? 0 : dominant / total,
    letterRatio: total === 0 ? 1 : letters / total,
    markupRatio: rawLength === 0 ? 0 : Math.min(1, markup / rawLength),
    repeatedSentenceRatio,
    uniqueWordRatio,
  };
}

const grouped = (n: number) => n.toLocaleString('en-US');

/**
 * Request-time checks, no model call. Every failed rule is reported, each with what was measured and the threshold.
 * Never throws. The server passes `{ maxWords: sourceMaxWords }`; the web form uses the defaults.
 */
export function guard(
  input: { kind: UploadKind; content: string },
  config: Partial<GuardConfig> = {},
): GuardResult {
  const cfg: GuardConfig = { ...GUARD_DEFAULTS, ...config };
  const content = typeof input.content === 'string' ? input.content : '';
  const metrics = measureText(input.kind === 'markdown' ? 'markdown' : 'text', content);
  const reasons: GuardReason[] = [];

  if (input.kind === 'url') {
    reasons.push({
      code: 'unsupported_kind',
      message: 'URL sources are not supported yet. Paste the text instead.',
    });
    return { ok: false, reasons, metrics };
  }

  if (metrics.words < cfg.minWords) {
    reasons.push({
      code: 'too_short',
      message: `Add more text: at least ${grouped(cfg.minWords)} words are needed.`,
      measured: metrics.words,
      threshold: cfg.minWords,
    });
  }
  if (metrics.words > cfg.maxWords) {
    reasons.push({
      code: 'too_long',
      message: `Shorten the text to ${grouped(cfg.maxWords)} words or split it into several sources.`,
      measured: metrics.words,
      threshold: cfg.maxWords,
    });
  }

  const hasText = nonSpaceLength(content) > 0;
  if (hasText) {
    const lowDiversity =
      metrics.distinctChars < cfg.minDistinctChars ||
      metrics.dominantCharShare > cfg.maxDominantCharShare ||
      metrics.letterRatio < cfg.minLetterRatio;
    if (lowDiversity) {
      // Report the measurement that is furthest past its limit.
      const candidates = [
        {
          measured: metrics.distinctChars,
          threshold: cfg.minDistinctChars,
          over: cfg.minDistinctChars - metrics.distinctChars,
        },
        {
          measured: metrics.dominantCharShare,
          threshold: cfg.maxDominantCharShare,
          over: metrics.dominantCharShare - cfg.maxDominantCharShare,
        },
        {
          measured: metrics.letterRatio,
          threshold: cfg.minLetterRatio,
          over: cfg.minLetterRatio - metrics.letterRatio,
        },
      ];
      const worst = candidates.reduce((a, b) => (b.over > a.over ? b : a));
      reasons.push({
        code: 'low_diversity',
        message: 'The text looks like repeated or non-text characters.',
        measured: worst.measured,
        threshold: worst.threshold,
      });
    }
    if (metrics.markupRatio > cfg.maxMarkupRatio) {
      reasons.push({
        code: 'mostly_markup',
        message: 'The text is mostly markup or links. Paste the readable content only.',
        measured: metrics.markupRatio,
        threshold: cfg.maxMarkupRatio,
      });
    }
    const repeatedSentences = metrics.repeatedSentenceRatio > cfg.maxRepeatedSentenceRatio;
    if (repeatedSentences || metrics.uniqueWordRatio < cfg.minUniqueWordRatio) {
      reasons.push({
        code: 'repeated_content',
        message: 'The same content is repeated many times. Paste it once.',
        measured: repeatedSentences ? metrics.repeatedSentenceRatio : metrics.uniqueWordRatio,
        threshold: repeatedSentences ? cfg.maxRepeatedSentenceRatio : cfg.minUniqueWordRatio,
      });
    }
  }

  return { ok: reasons.length === 0, reasons, metrics };
}

// ─── Brief guard ─────────────────────────────────────────────────────────────

export const BRIEF_SUBJECT_MIN = 3;
export const BRIEF_SUBJECT_MAX = 120;
export const BRIEF_FOCUS_MAX = 300;
export const BRIEF_SENTENCES_MIN = 3;
export const BRIEF_SENTENCES_MAX = 10;
const BRIEF_MIN_LETTER_RATIO = 0.6;
const BRIEF_MAX_DOMINANT_SHARE = 0.5;

export type BriefIssuePath = 'brief.subject' | 'brief.focus' | 'brief.sentences';
export interface BriefGuardReason extends GuardReason {
  /** The request field the reason belongs to, for the 422 issue list. */
  path: BriefIssuePath;
}
export interface BriefGuardResult {
  ok: boolean;
  reasons: BriefGuardReason[];
  /** Measured on the subject. */
  metrics: GuardMetrics;
}

const URL_LIKE = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+$/i;
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Matches control characters on purpose.
const CONTROL_CHAR = /[\u0000-\u0008\u000B-\u001F\u007F]/;

/** The messages of the HTTP contract (one per reason code). */
export const BRIEF_MESSAGES = Object.freeze({
  brief_too_short: 'Name the subject in a few words, for example "B-tree indexes".',
  brief_too_long: 'Keep the subject under 120 characters and the focus under 300.',
  brief_no_letters: 'The subject should be words, not numbers or symbols.',
  brief_not_a_topic: 'That does not look like a topic. Describe what you want to practise.',
  brief_sentences_out_of_range: 'Choose between 3 and 10 sentences.',
});

/** True when the text is a URL or e-mail address, one character or word repeated, mostly one character, or has a control character. */
function notATopic(text: string): boolean {
  if (CONTROL_CHAR.test(text)) return true;
  const flat = text.trim();
  if (URL_LIKE.test(flat) || EMAIL_LIKE.test(flat)) return true;
  const compact = Array.from(flat.replace(/\s+/gu, '').toLowerCase());
  if (compact.length === 0) return false;
  const frequency = new Map<string, number>();
  for (const ch of compact) frequency.set(ch, (frequency.get(ch) ?? 0) + 1);
  if (frequency.size === 1 && compact.length > 1) return true;
  const words = flat.toLowerCase().split(/\s+/u);
  if (words.length >= 2 && new Set(words).size === 1) return true;
  const dominant = Math.max(...frequency.values());
  return compact.length >= 4 && dominant / compact.length > BRIEF_MAX_DOMINANT_SHARE;
}

/**
 * Request-time checks on a prompt brief, no model call. Every failed rule is reported, each with the request field it
 * belongs to. Never throws; it only decides whether the text looks like a topic, not whether the topic is real.
 */
export function guardBrief(brief: {
  subject: string;
  focus?: string | undefined;
  sentences: number;
}): BriefGuardResult {
  const subject = typeof brief.subject === 'string' ? brief.subject.trim() : '';
  const focus = typeof brief.focus === 'string' ? brief.focus.trim() : '';
  const reasons: BriefGuardReason[] = [];
  const add = (
    code: GuardReasonCode,
    path: BriefIssuePath,
    message: string,
    measured?: number,
    threshold?: number,
  ) =>
    reasons.push({
      code,
      path,
      message,
      ...(measured !== undefined ? { measured } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
    });

  const subjectLength = Array.from(subject).length;
  const hasWord = /\p{L}{3,}/u.test(subject);
  if (subjectLength < BRIEF_SUBJECT_MIN || !hasWord) {
    add(
      'brief_too_short',
      'brief.subject',
      BRIEF_MESSAGES.brief_too_short,
      subjectLength,
      BRIEF_SUBJECT_MIN,
    );
  }
  if (subjectLength > BRIEF_SUBJECT_MAX) {
    add(
      'brief_too_long',
      'brief.subject',
      BRIEF_MESSAGES.brief_too_long,
      subjectLength,
      BRIEF_SUBJECT_MAX,
    );
  }
  const focusLength = Array.from(focus).length;
  if (focusLength > BRIEF_FOCUS_MAX) {
    add(
      'brief_too_long',
      'brief.focus',
      BRIEF_MESSAGES.brief_too_long,
      focusLength,
      BRIEF_FOCUS_MAX,
    );
  }

  const compact = Array.from(subject.replace(/\s+/gu, ''));
  if (compact.length > 0) {
    const letters = compact.filter((ch) => /\p{L}/u.test(ch)).length;
    if (letters / compact.length < BRIEF_MIN_LETTER_RATIO) {
      add(
        'brief_no_letters',
        'brief.subject',
        BRIEF_MESSAGES.brief_no_letters,
        letters / compact.length,
        BRIEF_MIN_LETTER_RATIO,
      );
    }
  }

  if (notATopic(subject))
    add('brief_not_a_topic', 'brief.subject', BRIEF_MESSAGES.brief_not_a_topic);
  if (focus !== '' && notATopic(focus)) {
    add('brief_not_a_topic', 'brief.focus', BRIEF_MESSAGES.brief_not_a_topic);
  }

  const sentences = brief.sentences;
  if (
    !Number.isInteger(sentences) ||
    sentences < BRIEF_SENTENCES_MIN ||
    sentences > BRIEF_SENTENCES_MAX
  ) {
    add(
      'brief_sentences_out_of_range',
      'brief.sentences',
      BRIEF_MESSAGES.brief_sentences_out_of_range,
      typeof sentences === 'number' ? sentences : undefined,
      sentences < BRIEF_SENTENCES_MIN ? BRIEF_SENTENCES_MIN : BRIEF_SENTENCES_MAX,
    );
  }

  return { ok: reasons.length === 0, reasons, metrics: measureText('text', subject) };
}
