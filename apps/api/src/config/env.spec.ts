import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv, type Env } from './env';

const SECRET_VALUE = 'super-secret-value-0123456789';
const ADMIN_EMAIL = 'boss.person@example.test';

/** A valid development environment; each test overrides what it exercises. */
const base: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://coach:pw@localhost:5432/coach',
  JWT_SECRET: 'a-development-secret-of-16+',
};

const cognito: NodeJS.ProcessEnv = {
  AUTH_MODE: 'cognito',
  COGNITO_REGION: 'eu-west-1',
  COGNITO_USER_POOL_ID: 'eu-west-1_AbCdEf123',
  COGNITO_CLIENT_ID: 'client123',
};

function problems(source: NodeJS.ProcessEnv): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return (error as EnvError).problems;
  }
  throw new Error('parseEnv did not throw');
}

const prodOk: NodeJS.ProcessEnv = {
  ...base,
  ...cognito,
  NODE_ENV: 'production',
  WEB_ORIGIN: 'https://coach.example.test',
  LLM_PROVIDER: 'openai',
  LLM_MODEL: 'gpt-x',
  LLM_API_KEY: SECRET_VALUE,
  EMBEDDING_PROVIDER: 'openai',
  EMBEDDING_MODEL: 'emb-x',
  EMBEDDING_API_KEY: SECRET_VALUE,
  EMBEDDING_DIM: '1536',
};

describe('parseEnv defaults', () => {
  it('applies the documented defaults', () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'log',
      API_PORT: 3001,
      WEB_ORIGIN: 'http://localhost:3000',
      TRUST_PROXY: 'loopback',
      FALKORDB_HOST: 'localhost',
      FALKORDB_PORT: 6379,
      GRAPH_NAME: 'coach',
      BOOTSTRAP_ADMIN_EMAILS: [],
      ALLOW_STUB_PROVIDERS: false,
      llm: { provider: 'stub' },
      embeddings: { provider: 'stub', dimension: 64 },
      tracer: { captureContent: false },
    });
    expect(env.auth).toEqual({ mode: 'dev', jwtSecret: base.JWT_SECRET });
  });

  it('treats empty strings (as written in .env.example) as unset', () => {
    const env = parseEnv({
      ...base,
      FALKORDB_USERNAME: '',
      COGNITO_REGION: '',
      BOOTSTRAP_ADMIN_EMAILS: '',
      LLM_MODEL: '',
    });
    expect(env.FALKORDB_USERNAME).toBeUndefined();
    expect(env.BOOTSTRAP_ADMIN_EMAILS).toEqual([]);
  });

  it('reads process.env only when no source is given, and never a dot-env file', () => {
    const apiRoot = join(__dirname, '..', '..');
    expect(readdirSync(apiRoot).filter((name) => name.startsWith('.env'))).toEqual([]);
    expect(existsSync(join(apiRoot, '.env'))).toBe(false);

    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://from-process/db';
    try {
      expect(parseEnv({ ...base, DATABASE_URL: 'postgres://from-source/db' }).DATABASE_URL).toBe(
        'postgres://from-source/db',
      );
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
    }
  });
});

describe('required values and dev mode', () => {
  it('reports a missing DATABASE_URL and a short JWT_SECRET in one error', () => {
    const list = problems({ JWT_SECRET: 'short' });
    expect(list).toContain('ENV DATABASE_URL: required');
    expect(list.some((line) => line.startsWith('ENV JWT_SECRET: '))).toBe(true);
    try {
      parseEnv({ JWT_SECRET: 'short' });
    } catch (error) {
      expect((error as Error).message).toContain('ENV DATABASE_URL');
      expect((error as Error).message).toContain('ENV JWT_SECRET');
    }
  });

  it('does not require JWT_SECRET in cognito mode', () => {
    const env = parseEnv({ DATABASE_URL: base.DATABASE_URL, ...cognito });
    expect(env.auth).toEqual({
      mode: 'cognito',
      region: 'eu-west-1',
      userPoolId: 'eu-west-1_AbCdEf123',
      clientId: 'client123',
      issuer: 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_AbCdEf123',
      jwksUri:
        'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_AbCdEf123/.well-known/jwks.json',
    });
  });

  it('does not read JWT_SECRET in cognito mode, even if it is invalid', () => {
    expect(() =>
      parseEnv({ DATABASE_URL: base.DATABASE_URL, JWT_SECRET: 'x', ...cognito }),
    ).not.toThrow();
  });

  it.each([
    ['COGNITO_REGION', 'ENV COGNITO_REGION: required when AUTH_MODE=cognito'],
    ['COGNITO_USER_POOL_ID', 'ENV COGNITO_USER_POOL_ID: required when AUTH_MODE=cognito'],
    ['COGNITO_CLIENT_ID', 'ENV COGNITO_CLIENT_ID: required when AUTH_MODE=cognito'],
  ])('reports a missing %s in every environment', (name, line) => {
    for (const nodeEnv of ['development', 'test', 'production']) {
      const source: NodeJS.ProcessEnv = {
        DATABASE_URL: base.DATABASE_URL,
        ...cognito,
        NODE_ENV: nodeEnv,
      };
      delete source[name];
      expect(problems(source)).toContain(line);
    }
  });

  it('reports one line per missing Cognito variable', () => {
    const list = problems({ DATABASE_URL: base.DATABASE_URL, AUTH_MODE: 'cognito' });
    expect(list.filter((line) => line.includes('required when AUTH_MODE=cognito'))).toHaveLength(3);
  });

  it('rejects an unknown AUTH_MODE without echoing it', () => {
    const list = problems({ ...base, AUTH_MODE: 'password-please' });
    expect(list.join('\n')).toContain('ENV AUTH_MODE');
    expect(list.join('\n')).not.toContain('password-please');
  });
});

describe('individual variables', () => {
  it('splits, trims, and lower-cases BOOTSTRAP_ADMIN_EMAILS', () => {
    const env = parseEnv({
      ...base,
      BOOTSTRAP_ADMIN_EMAILS: ' Boss.Person@Example.TEST , second@example.test ,',
    });
    expect(env.BOOTSTRAP_ADMIN_EMAILS).toEqual([ADMIN_EMAIL, 'second@example.test']);
  });

  it('rejects a non-address entry without echoing it', () => {
    const list = problems({ ...base, BOOTSTRAP_ADMIN_EMAILS: `${ADMIN_EMAIL},not-an-address-xyz` });
    expect(list.join('\n')).toContain('ENV BOOTSTRAP_ADMIN_EMAILS');
    expect(list.join('\n')).not.toContain('not-an-address-xyz');
  });

  it('rejects WEB_ORIGIN=*', () => {
    expect(problems({ ...base, WEB_ORIGIN: '*' }).join('\n')).toContain('ENV WEB_ORIGIN');
  });

  it('rejects a WEB_ORIGIN with a path', () => {
    expect(problems({ ...base, WEB_ORIGIN: 'http://localhost:3000/app' }).join('\n')).toContain(
      'ENV WEB_ORIGIN',
    );
    expect(parseEnv({ ...base, WEB_ORIGIN: 'http://localhost:3000' }).WEB_ORIGIN).toBe(
      'http://localhost:3000',
    );
  });

  it('rejects GRAPH_NAME=test_x and a malformed name', () => {
    expect(problems({ ...base, GRAPH_NAME: 'test_x' }).join('\n')).toContain('ENV GRAPH_NAME');
    expect(problems({ ...base, GRAPH_NAME: 'Bad Name' }).join('\n')).toContain('ENV GRAPH_NAME');
    expect(parseEnv({ ...base, GRAPH_NAME: 'my_graph1' }).GRAPH_NAME).toBe('my_graph1');
  });

  it('rejects out-of-range ports', () => {
    expect(problems({ ...base, API_PORT: '70000' }).join('\n')).toContain('ENV API_PORT');
    expect(problems({ ...base, FALKORDB_PORT: 'abc' }).join('\n')).toContain('ENV FALKORDB_PORT');
    expect(parseEnv({ ...base, API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it('rejects a DATABASE_URL that is not postgres:// or postgresql://, without echoing it', () => {
    const list = problems({ ...base, DATABASE_URL: `mysql://user:${SECRET_VALUE}@host/db` });
    expect(list.join('\n')).toContain('ENV DATABASE_URL');
    expect(list.join('\n')).not.toContain(SECRET_VALUE);
    expect(parseEnv({ ...base, DATABASE_URL: 'postgresql://u:p@h/db' }).DATABASE_URL).toBe(
      'postgresql://u:p@h/db',
    );
  });

  it('accepts TRUST_PROXY lists and rejects malformed entries', () => {
    expect(parseEnv({ ...base, TRUST_PROXY: 'loopback,172.28.0.0/16' }).TRUST_PROXY).toBe(
      'loopback,172.28.0.0/16',
    );
    expect(parseEnv({ ...base, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe('false');
    expect(
      parseEnv({ ...base, TRUST_PROXY: 'linklocal, uniquelocal, 10.0.0.1, ::1, fd00::/8' })
        .TRUST_PROXY,
    ).toBe('linklocal,uniquelocal,10.0.0.1,::1,fd00::/8');
    for (const bad of [
      'everybody',
      'loopback,300.1.1.1',
      '10.0.0.0/33',
      '10.0.0.0/',
      'true',
      ',,',
    ]) {
      expect(problems({ ...base, TRUST_PROXY: bad }).join('\n')).toContain('ENV TRUST_PROXY');
    }
  });
});

describe('provider groups', () => {
  it('reports both the missing key and the missing model for LLM_PROVIDER=openai', () => {
    const list = problems({ ...base, LLM_PROVIDER: 'openai' });
    expect(list).toContain('ENV LLM_MODEL: required when LLM_PROVIDER=openai');
    expect(list).toContain('ENV LLM_API_KEY: required when LLM_PROVIDER=openai');
  });

  it('requires a base URL and a model for ollama', () => {
    const list = problems({ ...base, LLM_PROVIDER: 'ollama' });
    expect(list).toContain('ENV LLM_MODEL: required when LLM_PROVIDER=ollama');
    expect(list).toContain('ENV LLM_BASE_URL: required when LLM_PROVIDER=ollama');
  });

  it('requires model, key, and dimension for non-stub embeddings', () => {
    const list = problems({ ...base, EMBEDDING_PROVIDER: 'openai' });
    expect(list).toContain('ENV EMBEDDING_MODEL: required when EMBEDDING_PROVIDER=openai');
    expect(list).toContain('ENV EMBEDDING_API_KEY: required when EMBEDDING_PROVIDER=openai');
    expect(list).toContain('ENV EMBEDDING_DIM: required when EMBEDDING_PROVIDER=openai');
  });

  it('builds the configs', () => {
    const env = parseEnv({
      ...base,
      LLM_PROVIDER: 'openai',
      LLM_MODEL: 'm',
      LLM_API_KEY: SECRET_VALUE,
      LLM_BASE_URL: 'http://localhost:11434/v1',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'e',
      EMBEDDING_BASE_URL: 'http://localhost:11434',
      EMBEDDING_DIM: '768',
    });
    expect(env.llm).toEqual({
      provider: 'openai',
      model: 'm',
      apiKey: SECRET_VALUE,
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(env.embeddings).toEqual({
      provider: 'ollama',
      model: 'e',
      baseUrl: 'http://localhost:11434',
      dimension: 768,
    });
  });

  it('uses EMBEDDING_DIM with the stub when given, and rejects out-of-range values', () => {
    expect(parseEnv({ ...base, EMBEDDING_DIM: '32' }).embeddings.dimension).toBe(32);
    expect(problems({ ...base, EMBEDDING_DIM: '9000' }).join('\n')).toContain('ENV EMBEDDING_DIM');
  });
});

describe('production rules', () => {
  it('accepts a complete production environment', () => {
    expect(() => parseEnv(prodOk)).not.toThrow();
  });

  it('refuses AUTH_MODE=dev', () => {
    expect(problems({ ...prodOk, AUTH_MODE: 'dev', JWT_SECRET: base.JWT_SECRET })).toContain(
      'ENV AUTH_MODE: the development sign-in is not allowed in production',
    );
  });

  it('refuses missing Cognito settings', () => {
    const source = { ...prodOk };
    delete source.COGNITO_USER_POOL_ID;
    expect(problems(source)).toContain('ENV COGNITO_USER_POOL_ID: required when AUTH_MODE=cognito');
  });

  it('refuses stub providers unless ALLOW_STUB_PROVIDERS=true', () => {
    const list = problems({ ...prodOk, LLM_PROVIDER: 'stub', EMBEDDING_PROVIDER: 'stub' });
    expect(list).toContain(
      'ENV LLM_PROVIDER: stub provider is not allowed in production (set ALLOW_STUB_PROVIDERS=true to override)',
    );
    expect(list).toContain(
      'ENV EMBEDDING_PROVIDER: stub provider is not allowed in production (set ALLOW_STUB_PROVIDERS=true to override)',
    );
    expect(() =>
      parseEnv({
        ...prodOk,
        LLM_PROVIDER: 'stub',
        EMBEDDING_PROVIDER: 'stub',
        ALLOW_STUB_PROVIDERS: 'true',
      }),
    ).not.toThrow();
  });

  it('refuses LANGFUSE_CAPTURE_CONTENT=true with or without keys', () => {
    const expected = 'ENV LANGFUSE_CAPTURE_CONTENT: content capture is not allowed in production';
    expect(problems({ ...prodOk, LANGFUSE_CAPTURE_CONTENT: 'true' })).toContain(expected);
    expect(
      problems({
        ...prodOk,
        LANGFUSE_CAPTURE_CONTENT: 'true',
        LANGFUSE_PUBLIC_KEY: 'pk',
        LANGFUSE_SECRET_KEY: SECRET_VALUE,
        LANGFUSE_HOST: 'https://langfuse.example.test',
      }),
    ).toContain(expected);
  });

  it('refuses a WEB_ORIGIN that is not https', () => {
    expect(problems({ ...prodOk, WEB_ORIGIN: 'http://coach.example.test' })).toContain(
      'ENV WEB_ORIGIN: must be an https origin in production',
    );
  });

  it('reports every violated rule together', () => {
    const list = problems({
      ...base,
      NODE_ENV: 'production',
      AUTH_MODE: 'dev',
      WEB_ORIGIN: 'http://localhost:3000',
      LANGFUSE_CAPTURE_CONTENT: 'true',
    });
    expect(
      list.filter((line) => /not allowed in production|must be an https origin/.test(line)),
    ).toHaveLength(5);
  });

  it('passes the same values outside production', () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: 'development',
        AUTH_MODE: 'dev',
        WEB_ORIGIN: 'http://localhost:3000',
        LLM_PROVIDER: 'stub',
        LANGFUSE_CAPTURE_CONTENT: 'true',
      }),
    ).not.toThrow();
  });
});

describe('secrets and personal data', () => {
  it('keeps secret values and e-mail addresses out of every error message', () => {
    const source: NodeJS.ProcessEnv = {
      DATABASE_URL: `mysql://u:${SECRET_VALUE}@h/db`,
      JWT_SECRET: 'short-secret-1',
      BOOTSTRAP_ADMIN_EMAILS: `${ADMIN_EMAIL},broken`,
      FALKORDB_PASSWORD: SECRET_VALUE,
      LLM_PROVIDER: 'openai',
      LLM_API_KEY: SECRET_VALUE,
      EMBEDDING_PROVIDER: 'openai',
      EMBEDDING_API_KEY: SECRET_VALUE,
      LANGFUSE_SECRET_KEY: SECRET_VALUE,
      NODE_ENV: 'production',
      LANGFUSE_CAPTURE_CONTENT: 'true',
      WEB_ORIGIN: `http://${SECRET_VALUE}.test`,
    };
    let message = '';
    try {
      parseEnv(source);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.length).toBeGreaterThan(0);
    for (const forbidden of [SECRET_VALUE, 'short-secret-1', ADMIN_EMAIL, 'broken']) {
      expect(message).not.toContain(forbidden);
    }
  });

  it('does not read LOGIN_*, REGISTRATION_*, or SEED_DEMO_PASSWORD', () => {
    const env = parseEnv({
      ...base,
      LOGIN_MAX_ATTEMPTS: 'not-a-number',
      LOGIN_WINDOW_SECONDS: '-5',
      REGISTRATION_MODE: 'whatever',
      REGISTRATION_CODE: SECRET_VALUE,
      SEED_DEMO_PASSWORD: SECRET_VALUE,
    });
    expect(JSON.stringify(env)).not.toContain(SECRET_VALUE);
    expect(Object.keys(env).some((key) => /LOGIN|REGISTRATION|SEED_DEMO/.test(key))).toBe(false);
  });
});

describe('Langfuse settings', () => {
  const noneSomeAll: Array<Record<string, string>> = [
    {},
    { LANGFUSE_PUBLIC_KEY: 'pk' },
    { LANGFUSE_SECRET_KEY: SECRET_VALUE, LANGFUSE_HOST: 'https://langfuse.example.test' },
    {
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: SECRET_VALUE,
      LANGFUSE_HOST: 'https://langfuse.example.test',
    },
  ];

  it.each(noneSomeAll.map((extra, index) => [index, extra] as const))(
    'does not fail with %i set (none, some, or all)',
    (_i, extra) => {
      const env: Env = parseEnv({ ...base, ...extra });
      expect(env.tracer.publicKey).toBe(extra.LANGFUSE_PUBLIC_KEY);
      expect(env.tracer.secretKey).toBe(extra.LANGFUSE_SECRET_KEY);
      expect(env.tracer.host).toBe(extra.LANGFUSE_HOST);
    },
  );

  it('defaults LANGFUSE_CAPTURE_CONTENT to false and reads true', () => {
    expect(parseEnv(base).tracer.captureContent).toBe(false);
    expect(parseEnv({ ...base, LANGFUSE_CAPTURE_CONTENT: 'true' }).tracer.captureContent).toBe(
      true,
    );
  });

  it('rejects a LANGFUSE_HOST that is not http(s)', () => {
    expect(problems({ ...base, LANGFUSE_HOST: 'ftp://example.test' }).join('\n')).toContain(
      'ENV LANGFUSE_HOST',
    );
  });
});
