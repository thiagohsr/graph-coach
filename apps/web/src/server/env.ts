import { z } from 'zod';

// Server environment (contracts/web-server.md §1). Read at start from the single root .env (loaded by the
// dev and start scripts); never at build time, and never imported by browser code.

/** Empty strings in .env (for example `COGNITO_DOMAIN=`) mean "unset". */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const optionalString = z.preprocess(blankToUndefined, z.string().optional());

const booleanFlag = z.preprocess((v) => {
  const raw = blankToUndefined(v);
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  return raw;
}, z.boolean().default(false));

const EnvSchema = z
  .object({
    NODE_ENV: optionalString,
    WEB_PORT: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(1).max(65535).default(3000),
    ),
    API_URL: z.preprocess(blankToUndefined, z.string().url().default('http://localhost:3001/api')),
    COOKIE_SECURE: booleanFlag,
    AUTH_MODE: z.preprocess(blankToUndefined, z.enum(['cognito', 'dev']).default('dev')),
    SESSION_SECRET: z
      .string({ required_error: 'SESSION_SECRET is required' })
      .min(32, 'SESSION_SECRET must be at least 32 characters'),
    COGNITO_DOMAIN: optionalString,
    COGNITO_CLIENT_ID: optionalString,
    WEB_ORIGIN: z.preprocess(blankToUndefined, z.string().url().optional()),
    TRUST_PROXY: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'AUTH_MODE=dev is refused when NODE_ENV=production',
      });
    }
    if (env.AUTH_MODE === 'cognito') {
      for (const key of ['COGNITO_DOMAIN', 'COGNITO_CLIENT_ID', 'WEB_ORIGIN'] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when AUTH_MODE=cognito`,
          });
      }
    }
  });

export interface WebEnv {
  nodeEnv: string | undefined;
  port: number;
  /** Upstream base URL including `/api`, without a trailing slash. */
  apiUrl: string;
  cookieSecure: boolean;
  authMode: 'cognito' | 'dev';
  sessionSecret: string;
  cognitoDomain: string | undefined;
  cognitoClientId: string | undefined;
  /** Public origin without a trailing slash, when set. */
  webOrigin: string | undefined;
  /** Raw TRUST_PROXY setting; empty when unset. */
  trustProxy: string;
}

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Pure parser (used by tests); throws EnvError naming each offending variable. */
export function parseEnv(source: Record<string, string | undefined>): WebEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`),
    );
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.WEB_PORT,
    apiUrl: e.API_URL.replace(/\/+$/, ''),
    cookieSecure: e.COOKIE_SECURE,
    authMode: e.AUTH_MODE,
    sessionSecret: e.SESSION_SECRET,
    cognitoDomain: e.COGNITO_DOMAIN,
    cognitoClientId: e.COGNITO_CLIENT_ID,
    webOrigin: e.WEB_ORIGIN ? new URL(e.WEB_ORIGIN).origin : undefined,
    trustProxy: e.TRUST_PROXY ?? '',
  };
}

let cached: WebEnv | undefined;

/** Reads process.env once, on first use at runtime. */
export function getEnv(): WebEnv {
  cached ??= parseEnv(process.env);
  return cached;
}

/** For tests. */
export function resetEnvCache(): void {
  cached = undefined;
}
