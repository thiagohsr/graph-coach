export interface Usage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
}

export const ZERO_USAGE: Readonly<Usage> = Object.freeze({
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  embeddingTokens: 0,
});

/** Field-wise sum; returns a new object. */
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    modelCalls: a.modelCalls + b.modelCalls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    embeddingTokens: a.embeddingTokens + b.embeddingTokens,
  };
}

export function sumUsage(items: Usage[]): Usage {
  return items.reduce(addUsage, { ...ZERO_USAGE });
}

export interface ChatResult {
  text: string;
  usage: Usage;
  usageReported: boolean;
}

export interface StructuredResult<T> {
  value: T;
  usage: Usage;
  usageReported: boolean;
  attempts: number;
}

export interface EmbeddingsResult {
  vectors: number[][];
  usage: Usage;
  usageReported: boolean;
}
