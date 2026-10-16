// Environment parsing (spec 002, contracts/cli-and-config.md §2). Reads `process.env` only; no dot-env file.
// Every problem is one line `ENV <NAME>: <reason>`. Messages never contain the offending value, so secrets and
// e-mail addresses cannot leak through an error.
import { isIP } from 'node:net';
import { z } from 'zod';

// The three provider config types live next to the provider code in `@coach/agents/llm` (contracts §4.3).
import type { EmbeddingsConfig, LlmConfig, TracerConfig } from '@coach/agents/llm';
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_MODEL,
} from '@coach/agents/llm';

export type { EmbeddingsConfig, LlmConfig, TracerConfig };

export type Provider = LlmConfig['provider'];

export type AuthConfig =
  | { mode: 'dev'; jwtSecret: string }
  | {
      mode: 'cognito';
      region: string;
      userPoolId: string;
      clientId: string;
      issuer: string;
      jwksUri: string;
    };

export type Env = {
  NODE_ENV: 'development' | 'test' | 'production';
  LOG_LEVEL: 'error' | 'warn' | 'log' | 'debug';
  API_PORT: number;
  WEB_ORIGIN: string;
  TRUST_PROXY: string;
  FALKORDB_HOST: string;
  FALKORDB_PORT: number;
  FALKORDB_USERNAME?: string;
  FALKORDB_PASSWORD?: string;
  GRAPH_NAME: string;
  DATABASE_URL: string;
  auth: AuthConfig;
  BOOTSTRAP_ADMIN_EMAILS: string[];
  llm: LlmConfig;
  embeddings: EmbeddingsConfig;
  ALLOW_STUB_PROVIDERS: boolean;
  /** Seconds between looks for queued `cover` tasks (spec 005 US7); 0 turns the poller off. */
  COVER_POLL_SECONDS: number;
  tracer: TracerConfig;
};

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
    this.name = 'EnvError';
  }
}

/** Every variable the API reads. Anything else in the environment is ignored. */
const KNOWN_KEYS = [
  'NODE_ENV',
  'LOG_LEVEL',
  'API_PORT',
  'WEB_ORIGIN',
  'TRUST_PROXY',
  'FALKORDB_HOST',
  'FALKORDB_PORT',
  'FALKORDB_USERNAME',
  'FALKORDB_PASSWORD',
  'GRAPH_NAME',
  'DATABASE_URL',
  'AUTH_MODE',
  'COGNITO_REGION',
  'COGNITO_USER_POOL_ID',
  'COGNITO_CLIENT_ID',
  'BOOTSTRAP_ADMIN_EMAILS',
  'JWT_SECRET',
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
  'EMBEDDING_BASE_URL',
  'EMBEDDING_API_KEY',
  'EMBEDDING_DIM',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'CF_ACCESS_CLIENT_ID',
  'CF_ACCESS_CLIENT_SECRET',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'OPENROUTER_EMBEDDING_MODEL',
  'ALLOW_STUB_PROVIDERS',
  'COVER_POLL_SECONDS',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_HOST',
  'LANGFUSE_CAPTURE_CONTENT',
] as const;

type Raw = Partial<Record<(typeof KNOWN_KEYS)[number], string>>;

const emailSchema = z.string().email().max(254);
const urlSchema = z.string().url();

function isPort(value: string): boolean {
  return /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
}

function isHttpUrl(value: string): boolean {
  return urlSchema.safeParse(value).success && /^https?:\/\//i.test(value);
}

function isOrigin(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  return new URL(value).origin === value;
}

function isProxyEntry(entry: string): boolean {
  if (['loopback', 'linklocal', 'uniquelocal'].includes(entry)) return true;
  if (isIP(entry) !== 0) return true;
  const slash = entry.indexOf('/');
  if (slash < 0) return false;
  const address = entry.slice(0, slash);
  const prefix = entry.slice(slash + 1);
  const family = isIP(address);
  if (family === 0 || !/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

const AWS_REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;
const USER_POOL_ID = /^[a-z]{2}(-[a-z]+)+-\d_[A-Za-z0-9]+$/;

/** Throws EnvError whose message is the full list of problems. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const raw: Raw = {};
  for (const key of KNOWN_KEYS) {
    const value = source[key]?.trim();
    if (value) raw[key] = value;
  }

  const problems: string[] = [];
  const fail = (name: string, reason: string) => problems.push(`ENV ${name}: ${reason}`);

  const oneOf = <T extends string>(name: keyof Raw, allowed: readonly T[], fallback: T): T => {
    const value = raw[name];
    if (value === undefined) return fallback;
    if ((allowed as readonly string[]).includes(value)) return value as T;
    fail(name, `must be one of ${allowed.join(', ')}`);
    return fallback;
  };

  const port = (name: keyof Raw, fallback: number): number => {
    const value = raw[name];
    if (value === undefined) return fallback;
    if (isPort(value)) return Number(value);
    fail(name, 'must be an integer from 1 to 65535');
    return fallback;
  };

  const nodeEnv = oneOf('NODE_ENV', ['development', 'test', 'production'], 'development');
  const production = nodeEnv === 'production';
  const logLevel = oneOf('LOG_LEVEL', ['error', 'warn', 'log', 'debug'], 'log');
  const apiPort = port('API_PORT', 3001);

  // WEB_ORIGIN
  const webOrigin = raw.WEB_ORIGIN ?? 'http://localhost:3000';
  if (raw.WEB_ORIGIN !== undefined && !isOrigin(webOrigin)) {
    fail(
      'WEB_ORIGIN',
      'must be a URL origin (scheme, host, optional port; no path and no wildcard)',
    );
  } else if (production && !webOrigin.startsWith('https://')) {
    fail('WEB_ORIGIN', 'must be an https origin in production');
  }

  // TRUST_PROXY
  let trustProxy = 'loopback';
  if (raw.TRUST_PROXY !== undefined) {
    if (raw.TRUST_PROXY === 'false') {
      trustProxy = 'false';
    } else {
      const entries = raw.TRUST_PROXY.split(',').map((entry) => entry.trim());
      if (entries.length > 0 && entries.every((entry) => entry !== '' && isProxyEntry(entry))) {
        trustProxy = entries.join(',');
      } else {
        fail(
          'TRUST_PROXY',
          'must be false or a comma-separated list of loopback, linklocal, uniquelocal, IP addresses, or CIDR ranges',
        );
      }
    }
  }

  // Stores
  const falkorHost = raw.FALKORDB_HOST ?? 'localhost';
  const falkorPort = port('FALKORDB_PORT', 6379);

  const graphName = raw.GRAPH_NAME ?? 'coach';
  if (raw.GRAPH_NAME !== undefined) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(graphName)) {
      fail('GRAPH_NAME', 'must match [a-z][a-z0-9_]{0,31}');
    } else if (graphName.startsWith('test_')) {
      fail('GRAPH_NAME', 'must not start with test_ (reserved for test graphs)');
    }
  }

  const databaseUrl = raw.DATABASE_URL ?? '';
  if (raw.DATABASE_URL === undefined) {
    fail('DATABASE_URL', 'required');
  } else if (
    !/^postgres(ql)?:\/\//i.test(databaseUrl) ||
    !urlSchema.safeParse(databaseUrl).success
  ) {
    fail('DATABASE_URL', 'must be a postgres:// or postgresql:// URL');
  }

  // Authentication
  const authMode = oneOf('AUTH_MODE', ['cognito', 'dev'], 'dev');
  let auth: AuthConfig;
  if (authMode === 'cognito') {
    let missing = false;
    for (const name of ['COGNITO_REGION', 'COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID'] as const) {
      if (raw[name] === undefined) {
        fail(name, 'required when AUTH_MODE=cognito');
        missing = true;
      }
    }
    const region = raw.COGNITO_REGION ?? '';
    const userPoolId = raw.COGNITO_USER_POOL_ID ?? '';
    if (!missing) {
      if (!AWS_REGION.test(region))
        fail('COGNITO_REGION', 'must be an AWS region name such as eu-west-1');
      if (!USER_POOL_ID.test(userPoolId))
        fail('COGNITO_USER_POOL_ID', 'must look like <region>_<id>');
    }
    const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
    auth = {
      mode: 'cognito',
      region,
      userPoolId,
      clientId: raw.COGNITO_CLIENT_ID ?? '',
      issuer,
      jwksUri: `${issuer}/.well-known/jwks.json`,
    };
  } else {
    if (raw.JWT_SECRET === undefined || raw.JWT_SECRET.length < 16) {
      fail('JWT_SECRET', 'required, at least 16 characters, when AUTH_MODE=dev');
    }
    auth = { mode: 'dev', jwtSecret: raw.JWT_SECRET ?? '' };
    if (production) fail('AUTH_MODE', 'the development sign-in is not allowed in production');
  }

  // Bootstrap administrators
  const adminEmails: string[] = [];
  if (raw.BOOTSTRAP_ADMIN_EMAILS !== undefined) {
    const entries = raw.BOOTSTRAP_ADMIN_EMAILS.split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    entries.forEach((entry, index) => {
      if (emailSchema.safeParse(entry).success) adminEmails.push(entry.toLowerCase());
      else fail('BOOTSTRAP_ADMIN_EMAILS', `entry ${index + 1} is not an e-mail address`);
    });
  }

  // Providers. `ollama-with-fallback` (chat) and `openrouter` (embeddings) read the OLLAMA_*, CF_ACCESS_*, and
  // OPENROUTER_* variables; the per-prefix LLM_*/EMBEDDING_* variables still override the model where they apply.
  const cfId = raw.CF_ACCESS_CLIENT_ID;
  const cfSecret = raw.CF_ACCESS_CLIENT_SECRET;
  if ((cfId === undefined) !== (cfSecret === undefined)) {
    fail(
      cfId === undefined ? 'CF_ACCESS_CLIENT_ID' : 'CF_ACCESS_CLIENT_SECRET',
      'must be set together with the other Cloudflare Access variable',
    );
  }
  const cfAccess = cfId !== undefined && cfSecret !== undefined ? { clientId: cfId, clientSecret: cfSecret } : undefined;
  const openRouterBase = 'https://openrouter.ai/api/v1';

  type Kind = 'stub' | 'openai' | 'ollama' | 'ollama-with-fallback' | 'openrouter';
  const provider = (
    prefix: 'LLM' | 'EMBEDDING',
    extra: 'ollama-with-fallback' | 'openrouter',
  ): { kind: Kind; model: string; baseUrl?: string; apiKey?: string } => {
    const kind = oneOf<Kind>(`${prefix}_PROVIDER`, ['stub', 'openai', 'ollama', extra], 'stub');
    const model =
      kind === 'ollama-with-fallback'
        ? (raw.OLLAMA_MODEL ?? raw.LLM_MODEL ?? DEFAULT_OLLAMA_MODEL)
        : kind === 'openrouter'
          ? (raw.EMBEDDING_MODEL ?? raw.OPENROUTER_EMBEDDING_MODEL ?? DEFAULT_OPENROUTER_EMBEDDING_MODEL)
          : raw[`${prefix}_MODEL`];
    const baseUrl =
      kind === 'ollama-with-fallback'
        ? (raw.OLLAMA_BASE_URL ?? raw.LLM_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL)
        : kind === 'openrouter'
          ? (raw[`${prefix}_BASE_URL`] ?? openRouterBase)
          : raw[`${prefix}_BASE_URL`];
    const apiKey =
      kind === 'openrouter' ? (raw[`${prefix}_API_KEY`] ?? raw.OPENROUTER_API_KEY) : raw[`${prefix}_API_KEY`];
    if (kind !== 'stub') {
      const needs = `required when ${prefix}_PROVIDER=${kind}`;
      if (model === undefined) fail(`${prefix}_MODEL`, needs);
      if (kind === 'ollama' && baseUrl === undefined) fail(`${prefix}_BASE_URL`, needs);
      if (kind === 'openai' && apiKey === undefined) fail(`${prefix}_API_KEY`, needs);
      if (kind === 'openrouter' && apiKey === undefined) fail('OPENROUTER_API_KEY', needs);
    }
    if (baseUrl !== undefined && baseUrl.startsWith('file://')) {
      if (!(prefix === 'LLM' && kind === 'stub'))
        fail(`${prefix}_BASE_URL`, 'a file:// URL is only allowed when LLM_PROVIDER=stub');
      else if (baseUrl.length <= 'file://'.length) fail(`${prefix}_BASE_URL`, 'file:// URL needs a directory');
    } else if (baseUrl !== undefined && !isHttpUrl(baseUrl))
      fail(kind === 'ollama-with-fallback' ? 'OLLAMA_BASE_URL' : `${prefix}_BASE_URL`, 'must be an http:// or https:// URL');
    if (production && kind === 'stub' && raw.ALLOW_STUB_PROVIDERS !== 'true') {
      fail(
        `${prefix}_PROVIDER`,
        'stub provider is not allowed in production (set ALLOW_STUB_PROVIDERS=true to override)',
      );
    }
    return {
      kind,
      model: model ?? (kind === 'stub' ? 'stub' : ''),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
    };
  };

  const chat = provider('LLM', 'ollama-with-fallback');
  if (chat.kind === 'ollama-with-fallback' && production && raw.OPENROUTER_API_KEY === undefined) {
    fail('OPENROUTER_API_KEY', 'required in production when LLM_PROVIDER=ollama-with-fallback');
  }
  const llm: LlmConfig = {
    provider: chat.kind as LlmConfig['provider'],
    model: chat.model,
    ...(chat.baseUrl !== undefined ? { baseUrl: chat.baseUrl } : {}),
    ...(chat.kind !== 'ollama-with-fallback' && chat.apiKey !== undefined ? { apiKey: chat.apiKey } : {}),
    ...(cfAccess && (chat.kind === 'ollama' || chat.kind === 'ollama-with-fallback') ? { cfAccess } : {}),
    ...(chat.kind === 'ollama-with-fallback' && raw.OPENROUTER_API_KEY !== undefined
      ? {
          fallback: {
            apiKey: raw.OPENROUTER_API_KEY,
            model: raw.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
          },
        }
      : {}),
  };
  const emb = provider('EMBEDDING', 'openrouter');
  const embeddingBase: Omit<EmbeddingsConfig, 'dimension'> = {
    provider: emb.kind as EmbeddingsConfig['provider'],
    model: emb.model,
    ...(emb.baseUrl !== undefined ? { baseUrl: emb.baseUrl } : {}),
    ...(emb.apiKey !== undefined ? { apiKey: emb.apiKey } : {}),
    ...(cfAccess && emb.kind === 'ollama' ? { cfAccess } : {}),
  };

  let dimension = 64;
  if (raw.EMBEDDING_DIM !== undefined) {
    if (
      /^\d{1,4}$/.test(raw.EMBEDDING_DIM) &&
      Number(raw.EMBEDDING_DIM) >= 1 &&
      Number(raw.EMBEDDING_DIM) <= 8192
    ) {
      dimension = Number(raw.EMBEDDING_DIM);
    } else {
      fail('EMBEDDING_DIM', 'must be an integer from 1 to 8192');
    }
  } else if (embeddingBase.provider !== 'stub') {
    fail('EMBEDDING_DIM', `required when EMBEDDING_PROVIDER=${embeddingBase.provider}`);
  }

  const allowStub = parseBool(raw.ALLOW_STUB_PROVIDERS);
  if (allowStub === undefined) fail('ALLOW_STUB_PROVIDERS', 'must be true or false');

  // Coverage requests (005 US7): seconds between looks for queued cover tasks; 0 = off.
  let coverPollSeconds = 30;
  if (raw.COVER_POLL_SECONDS !== undefined) {
    if (/^\d{1,5}$/.test(raw.COVER_POLL_SECONDS)) coverPollSeconds = Number(raw.COVER_POLL_SECONDS);
    else fail('COVER_POLL_SECONDS', 'must be a whole number of seconds, 0 or more');
  }

  // Usage tracer: none, some, or all of the three may be set; the consumer decides what to do.
  const captureContent = parseBool(raw.LANGFUSE_CAPTURE_CONTENT);
  if (captureContent === undefined) fail('LANGFUSE_CAPTURE_CONTENT', 'must be true or false');
  if (captureContent && production)
    fail('LANGFUSE_CAPTURE_CONTENT', 'content capture is not allowed in production');
  if (raw.LANGFUSE_HOST !== undefined && !isHttpUrl(raw.LANGFUSE_HOST)) {
    fail('LANGFUSE_HOST', 'must be an http:// or https:// URL');
  }

  if (problems.length > 0) throw new EnvError(problems);

  return {
    NODE_ENV: nodeEnv,
    LOG_LEVEL: logLevel,
    API_PORT: apiPort,
    WEB_ORIGIN: webOrigin,
    TRUST_PROXY: trustProxy,
    FALKORDB_HOST: falkorHost,
    FALKORDB_PORT: falkorPort,
    ...(raw.FALKORDB_USERNAME !== undefined ? { FALKORDB_USERNAME: raw.FALKORDB_USERNAME } : {}),
    ...(raw.FALKORDB_PASSWORD !== undefined ? { FALKORDB_PASSWORD: raw.FALKORDB_PASSWORD } : {}),
    GRAPH_NAME: graphName,
    DATABASE_URL: databaseUrl,
    auth,
    BOOTSTRAP_ADMIN_EMAILS: adminEmails,
    llm,
    embeddings: { ...embeddingBase, dimension },
    ALLOW_STUB_PROVIDERS: allowStub === true,
    COVER_POLL_SECONDS: coverPollSeconds,
    tracer: {
      ...(raw.LANGFUSE_PUBLIC_KEY !== undefined ? { publicKey: raw.LANGFUSE_PUBLIC_KEY } : {}),
      ...(raw.LANGFUSE_SECRET_KEY !== undefined ? { secretKey: raw.LANGFUSE_SECRET_KEY } : {}),
      ...(raw.LANGFUSE_HOST !== undefined ? { host: raw.LANGFUSE_HOST } : {}),
      captureContent: captureContent === true,
    },
  };
}
