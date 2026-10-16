// Optional model phrasing of the summary (stretch, T067). The model can change the summary text and nothing else: the
// target, puzzle, flags, and evidence are fixed before this runs. Any failure keeps the template.
import { ProviderError } from '../llm/errors';
import type { ChatProvider } from '../llm/types';
import { ZERO_USAGE, type Usage } from '../llm/usage';
import type { StepHandle } from '../llm/usage-tracer';
import { PHRASE_TIMEOUT_MS } from './constants';

const MAX_PHRASED = 400;

export interface PhraseResult {
  text: string;
  usage: Usage;
  /** Why the template was kept; absent when the rewrite was accepted. */
  fallback?: 'error' | 'rejected';
}

const SYSTEM =
  'You rewrite a short study-coaching summary in a friendly, plain tone. Keep every fact, number, and quoted name exactly. ' +
  `Answer with the rewritten text only, at most ${MAX_PHRASED} characters.`;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('phrasing timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * One `chatModel.complete` call (label `coach.phraseSummary`); the rewrite is read from `result.text` and used only when
 * it is 1 to 400 characters and contains every `mustContain` string. Otherwise, and on any error or timeout, the
 * template is returned. `usage` is the result's usage (also for a rejected rewrite) or the `ProviderError`'s.
 */
export async function phraseSummary(
  template: string,
  mustContain: string[],
  chatModel: ChatProvider,
  options: { timeoutMs?: number; trace?: StepHandle } = {},
): Promise<PhraseResult> {
  const timeoutMs = options.timeoutMs ?? PHRASE_TIMEOUT_MS;
  try {
    const result = await withTimeout(
      chatModel.complete(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: template },
        ],
        {
          label: 'coach.phraseSummary',
          timeoutMs,
          ...(options.trace ? { trace: options.trace } : {}),
        },
      ),
      timeoutMs,
    );
    const text = typeof result.text === 'string' ? result.text.trim() : '';
    const ok =
      text.length >= 1 &&
      text.length <= MAX_PHRASED &&
      mustContain.every((needle) => text.includes(needle));
    return ok
      ? { text, usage: result.usage }
      : { text: template, usage: result.usage, fallback: 'rejected' };
  } catch (error) {
    const usage = error instanceof ProviderError ? error.usage : { ...ZERO_USAGE };
    return { text: template, usage, fallback: 'error' };
  }
}
