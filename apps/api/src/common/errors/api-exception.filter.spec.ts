import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  InternalServerErrorException,
  type INestApplication,
  NotFoundException,
  Post,
  ConflictException,
  UnauthorizedException,
  type ArgumentsHost,
  MethodNotAllowedException,
  UnprocessableEntityException,
  RequestTimeoutException,
  HttpStatus,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { GraphUnavailableError } from '@coach/graph-kit';
import { DevLoginRequest } from '@coach/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import {
  AccountBlockedError,
  AppError,
  ConflictError,
  DomainInvalidError,
  ForbiddenError,
  MethodNotAllowedError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  UnavailableError,
  ValidationFailedError,
} from './app-error';
import { ApiExceptionFilter } from './api-exception.filter';

interface Captured {
  status?: number;
  body?: { error: { code: string; message: string; details?: unknown } };
  headers: Record<string, string>;
  ended: boolean;
}

/** Runs the filter against a fake Express response. */
function run(exception: unknown, options: { headersSent?: boolean } = {}): Captured {
  const captured: Captured = { headers: {}, ended: false };
  const response = {
    headersSent: options.headersSent ?? false,
    setHeader: (name: string, value: string) => void (captured.headers[name] = value),
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Captured['body']) {
      captured.body = body;
      return this;
    },
    end() {
      captured.ended = true;
    },
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', originalUrl: '/api/x' }),
    }),
  } as unknown as ArgumentsHost;
  const filter = new ApiExceptionFilter();
  vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  vi.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
  filter.catch(exception, host);
  return captured;
}

describe('ApiExceptionFilter: one case per row of the mapping table', () => {
  it('AppError: its own status and code', () => {
    const out = run(new ConflictError('Nope', { code: 'ALREADY_DECIDED' }));
    expect(out.status).toBe(409);
    expect(out.body).toEqual({ error: { code: 'ALREADY_DECIDED', message: 'Nope' } });
  });

  it('every AppError subclass maps to its documented status and code', () => {
    const cases: Array<[AppError, number, string]> = [
      [new ValidationFailedError([{ path: 'a', message: 'bad' }]), 422, 'VALIDATION_FAILED'],
      [new DomainInvalidError('CODE_INVALID', 'That code is not valid'), 422, 'CODE_INVALID'],
      [new DomainInvalidError('SOURCE_REJECTED', 'x'), 422, 'SOURCE_REJECTED'],
      [new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
      [new UnauthenticatedError('No such user', 'INVALID_CREDENTIALS'), 401, 'INVALID_CREDENTIALS'],
      [new ForbiddenError(), 403, 'FORBIDDEN'],
      [new AccountBlockedError(), 403, 'ACCOUNT_BLOCKED'],
      [new NotFoundError('Puzzle'), 404, 'NOT_FOUND'],
      [new MethodNotAllowedError('Read only'), 405, 'ADMIN_MODEL_READ_ONLY'],
      [new ConflictError('x'), 409, 'CONFLICT'],
      [new UnavailableError('CREATION_PAUSED', 'Paused'), 503, 'CREATION_PAUSED'],
      [new UnavailableError('SQL_UNAVAILABLE', 'x'), 503, 'SQL_UNAVAILABLE'],
    ];
    for (const [error, status, code] of cases) {
      const out = run(error);
      expect([out.status, out.body?.error.code]).toEqual([status, code]);
    }
  });

  it('403 ACCOUNT_BLOCKED has no details', () => {
    const out = run(new AccountBlockedError());
    expect(out.status).toBe(403);
    expect(out.body?.error).toEqual({
      code: 'ACCOUNT_BLOCKED',
      message: 'This account is blocked',
    });
  });

  it('429: Retry-After header and RateLimitDetails including window, kind, canRedeemCode', () => {
    const resetAt = new Date('2026-11-01T00:00:00.000Z');
    const out = run(
      new RateLimitedError(
        { resetAt, retryAfterSeconds: 90, window: 'month' },
        'CREATION_LIMIT_REACHED',
        undefined,
        {
          kind: 'prompt',
          canRedeemCode: true,
        },
      ),
    );
    expect(out.status).toBe(429);
    expect(out.headers['Retry-After']).toBe('90');
    expect(out.body?.error.code).toBe('CREATION_LIMIT_REACHED');
    expect(out.body?.error.details).toEqual({
      retryAfterSeconds: 90,
      resetAt: '2026-11-01T00:00:00.000Z',
      window: 'month',
      kind: 'prompt',
      canRedeemCode: true,
    });
  });

  it('429 default code is RATE_LIMITED and details omit the optional fields', () => {
    const out = run(new RateLimitedError({ resetAt: new Date(0), retryAfterSeconds: 3 }));
    expect(out.body?.error.code).toBe('RATE_LIMITED');
    expect(out.headers['Retry-After']).toBe('3');
    expect(out.body?.error.details).toEqual({
      retryAfterSeconds: 3,
      resetAt: '1970-01-01T00:00:00.000Z',
    });
  });

  it('body parser error (unparseable JSON): 400 VALIDATION_FAILED without details', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token'), {
      type: 'entity.parse.failed',
      status: 400,
    });
    const out = run(parseError);
    expect(out.status).toBe(400);
    expect(out.body?.error.code).toBe('VALIDATION_FAILED');
    expect(out.body?.error.details).toBeUndefined();
  });

  it('ZodError: 422 VALIDATION_FAILED with all issues and dotted paths, never 400', () => {
    const schema = z.object({ name: z.string(), answers: z.array(z.object({ word: z.string() })) });
    const result = schema.safeParse({ name: 1, answers: [{ word: 'ok' }, {}, { word: 3 }] });
    expect(result.success).toBe(false);
    const out = run((result as { error: ZodError }).error);
    expect(out.status).toBe(422);
    const issues = (out.body?.error.details as { issues: Array<{ path: string; message: string }> })
      .issues;
    expect(issues.map((i) => i.path)).toEqual(['name', 'answers.1.word', 'answers.2.word']);
  });

  it.each([
    [UnauthorizedException, 401, 'UNAUTHENTICATED'],
    [ForbiddenException, 403, 'FORBIDDEN'],
    [NotFoundException, 404, 'NOT_FOUND'],
    [MethodNotAllowedException, 405, 'ADMIN_MODEL_READ_ONLY'],
    [ConflictException, 409, 'CONFLICT'],
    [UnprocessableEntityException, 422, 'VALIDATION_FAILED'],
  ])('Nest %p: %i %s', (Exception, status, code) => {
    const out = run(new Exception());
    expect([out.status, out.body?.error.code]).toEqual([status, code]);
  });

  it('Nest HttpException 429 -> RATE_LIMITED', () => {
    const out = run(new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS));
    expect([out.status, out.body?.error.code]).toEqual([429, 'RATE_LIMITED']);
  });

  it('other 4xx Nest exceptions -> 422 VALIDATION_FAILED', () => {
    for (const exception of [
      new BadRequestException('bad'),
      new RequestTimeoutException(),
      new HttpException('big', 413),
    ]) {
      const out = run(exception);
      expect([out.status, out.body?.error.code]).toEqual([422, 'VALIDATION_FAILED']);
    }
  });

  it('Nest 5xx -> 500 INTERNAL with the generic message', () => {
    const out = run(new InternalServerErrorException('secret internals'));
    expect(out.status).toBe(500);
    expect(out.body?.error).toEqual({ code: 'INTERNAL', message: 'Unexpected error' });
  });

  it('GraphUnavailableError -> 503 GRAPH_UNAVAILABLE', () => {
    const out = run(new GraphUnavailableError());
    expect([out.status, out.body?.error.code]).toEqual([503, 'GRAPH_UNAVAILABLE']);
  });

  it('Postgres connection errors (also wrapped in a cause) -> 503 SQL_UNAVAILABLE', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const wrapped = Object.assign(new Error('Failed query: select 1'), {
      cause: Object.assign(new Error('closed'), { code: 'CONNECTION_CLOSED' }),
    });
    for (const error of [refused, wrapped]) {
      const out = run(error);
      expect([out.status, out.body?.error.code]).toEqual([503, 'SQL_UNAVAILABLE']);
    }
  });

  it('ProviderUnavailableError -> 503 PROVIDER_UNAVAILABLE', () => {
    class ProviderUnavailableError extends Error {}
    const out = run(new ProviderUnavailableError('LLM provider is "stub"'));
    expect([out.status, out.body?.error.code]).toEqual([503, 'PROVIDER_UNAVAILABLE']);
  });

  it('anything else -> 500 INTERNAL, generic message, full error logged', () => {
    const filter = new ApiExceptionFilter();
    const logged = vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    const captured: { status?: number; body?: unknown } = {};
    const response = {
      headersSent: false,
      setHeader: () => undefined,
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(body: unknown) {
        captured.body = body;
      },
    };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: 'POST', originalUrl: '/api/y' }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(new TypeError('database password is hunter2'), host);
    expect(captured.status).toBe(500);
    expect(captured.body).toEqual({ error: { code: 'INTERNAL', message: 'Unexpected error' } });
    expect(JSON.stringify(captured.body)).not.toContain('hunter2');
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[1])).toContain('hunter2');
  });

  it('a response that already started streaming is closed, not rewritten', () => {
    const out = run(new Error('late failure'), { headersSent: true });
    expect(out.ended).toBe(true);
    expect(out.status).toBeUndefined();
    expect(out.body).toBeUndefined();
  });
});

@Controller('probe')
class ProbeController {
  @Post('body')
  body(@Body(new ZodValidationPipe(DevLoginRequest)) body: DevLoginRequest) {
    return body;
  }

  @Get('blocked')
  blocked() {
    throw new AccountBlockedError();
  }

  @Get('limited')
  limited() {
    throw new RateLimitedError({
      resetAt: new Date('2030-01-01T00:00:00Z'),
      retryAfterSeconds: 12,
      window: 'short',
    });
  }

  @Get('boom')
  boom() {
    throw new Error('internal detail');
  }
}

describe('ApiExceptionFilter inside a Nest application', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('unparseable JSON -> 400 VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/body')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toBeUndefined();
  });

  it('schema failure -> 422 with every issue, and valid input is transformed', async () => {
    const bad = await request(app.getHttpServer()).post('/probe/body').send({ email: 'nope' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.error.details.issues[0].path).toBe('email');

    const good = await request(app.getHttpServer())
      .post('/probe/body')
      .send({ email: '  Ada@Example.TEST ', extra: 1 });
    expect(good.status).toBe(201);
    expect(good.body).toEqual({ email: 'ada@example.test' });
  });

  it('403 ACCOUNT_BLOCKED, 429 with Retry-After, 404 unknown route, 500 generic', async () => {
    const server = app.getHttpServer();
    const blocked = await request(server).get('/probe/blocked');
    expect([blocked.status, blocked.body.error.code]).toEqual([403, 'ACCOUNT_BLOCKED']);

    const limited = await request(server).get('/probe/limited');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('12');
    expect(limited.body.error.details).toEqual({
      retryAfterSeconds: 12,
      resetAt: '2030-01-01T00:00:00.000Z',
      window: 'short',
    });

    const missing = await request(server).get('/probe/nope');
    expect([missing.status, missing.body.error.code]).toEqual([404, 'NOT_FOUND']);

    const boom = await request(server).get('/probe/boom');
    expect(boom.status).toBe(500);
    expect(boom.body).toEqual({ error: { code: 'INTERNAL', message: 'Unexpected error' } });
  });
});
