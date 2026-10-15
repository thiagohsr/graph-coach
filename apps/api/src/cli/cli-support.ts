import { createInterface } from 'node:readline';
import { AppError, ValidationFailedError } from '../common/errors/app-error';

/** A failure the operator should read: printed as one line, then exit with `exitCode` (1 by default, 2 = cancelled). */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2 = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** Where commands print. Plain text lines; tests replace it to capture. */
export interface CliOutput {
  line(text: string): void;
  error(text: string): void;
}

export const CLI_OUTPUT = Symbol('CLI_OUTPUT');

export const consoleOutput: CliOutput = {
  line: (text) => process.stdout.write(`${text}\n`),
  error: (text) => process.stderr.write(`${text}\n`),
};

/** Asks the operator one question and returns the answer ('' on end of input). Tests replace it. */
export type CliPrompt = (question: string) => Promise<string>;

export const CLI_PROMPT = Symbol('CLI_PROMPT');

export const readlinePrompt: CliPrompt = (question) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
    rl.on('close', () => {
      if (!answered) resolve('');
    });
  });

/** Turns anything a command threw into its message lines and exit code. */
export function describeFailure(error: unknown): { lines: string[]; exitCode: number } {
  if (error instanceof CliError) return { lines: [error.message], exitCode: error.exitCode };
  if (error instanceof ValidationFailedError) {
    const issues = (error.details as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues ?? [];
    return {
      lines: [error.message, ...issues.map((issue) => `  ${issue.path}: ${issue.message}`)],
      exitCode: 1,
    };
  }
  if (error instanceof AppError) return { lines: [error.message], exitCode: 1 };
  const message = error instanceof Error ? error.message : String(error);
  return { lines: [`Command failed: ${message}`], exitCode: 1 };
}

/** Parses a non-negative integer flag value. */
export function parseCount(flag: string, value: string, max?: number): number {
  if (!/^\d+$/.test(value) || (max !== undefined && Number(value) > max)) {
    throw new CliError(`${flag}: must be a whole number${max !== undefined ? ` from 0 to ${max}` : ' (0 or more)'}`);
  }
  return Number(value);
}
