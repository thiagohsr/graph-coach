import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiError, ErrorCode, ValidationDetails } from '@coach/types';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, RateLimitedError } from './app-error';

export interface MappedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
  /** Seconds for the Retry-After header (429 only). */
  retryAfterSeconds?: number;
  /** True when the full error must be logged server-side (anything unexpected). */
  log: boolean;
}

const HTTP_CODES: Record<number, ErrorCode> = {
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'ADMIN_MODEL_READ_ONLY',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

const SQL_CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'EPIPE',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'CONNECT_TIMEOUT',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
]);

function isSqlConnectionError(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 4) return false;
  const { code, cause, errors } = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof code === 'string' && SQL_CONNECTION_CODES.has(code)) return true;
  if (
    Array.isArray(errors) &&
    errors.length > 0 &&
    errors.every((inner) => isSqlConnectionError(inner, depth + 1))
  )
    return true;
  return isSqlConnectionError(cause, depth + 1);
}

function issuesOf(error: ZodError): ValidationDetails['issues'] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/** The status-and-code table of contracts/internal-interfaces.md §5.6, as a pure function. */
export function mapException(exception: unknown): MappedError {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      code: exception.code,
      message: exception.message,
      ...(exception.details !== undefined ? { details: exception.details } : {}),
      ...(exception instanceof RateLimitedError
        ? { retryAfterSeconds: exception.retryAfterSeconds }
        : {}),
      log: false,
    };
  }

  // Body parser error (unparseable JSON): 400, the only 400 of the API.
  const parserType = (exception as { type?: unknown } | null)?.type;
  if (parserType === 'entity.parse.failed') {
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Request body is not valid JSON',
      log: false,
    };
  }

  if (exception instanceof ZodError) {
    return {
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: { issues: issuesOf(exception) } satisfies ValidationDetails,
      log: false,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    // Nest rewraps the body parser's SyntaxError as a BadRequestException; its message is the JSON parser's
    // ("Unexpected end of JSON input", "... is not valid JSON"). That is the one 400 of the API.
    if (status === 400 && /\bJSON\b/.test(exception.message)) {
      return {
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'Request body is not valid JSON',
        log: false,
      };
    }
    if (status >= 500)
      return { status: 500, code: 'INTERNAL', message: 'Unexpected error', log: true };
    return {
      status: HTTP_CODES[status] ? status : 422,
      code: HTTP_CODES[status] ?? 'VALIDATION_FAILED',
      message: exception.message,
      log: false,
    };
  }

  const named = exception as {
    name?: unknown;
    code?: unknown;
    constructor?: { name?: unknown };
  } | null;
  const typeName = named?.name === 'Error' ? named.constructor?.name : named?.name;
  if (typeName === 'GraphUnavailableError' || named?.code === 'GRAPH_UNAVAILABLE') {
    return {
      status: 503,
      code: 'GRAPH_UNAVAILABLE',
      message: 'The graph database is not available',
      log: true,
    };
  }
  if (typeName === 'ProviderUnavailableError') {
    return {
      status: 503,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'The model provider is not available',
      log: true,
    };
  }
  if (isSqlConnectionError(exception)) {
    return {
      status: 503,
      code: 'SQL_UNAVAILABLE',
      message: 'The database is not available',
      log: true,
    };
  }

  return { status: 500, code: 'INTERNAL', message: 'Unexpected error', log: true };
}

/** Turns every thrown value into the envelope `{ error: { code, message, details? } }`. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const mapped = mapException(exception);

    if (mapped.log) {
      const detail =
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      this.logger.error(
        `${request?.method ?? ''} ${request?.originalUrl ?? ''} -> ${mapped.status} ${mapped.code}`,
        detail,
      );
    }

    // A response that has already started (an event stream) cannot change status: close it.
    if (response.headersSent) {
      if (!mapped.log) this.logger.warn(`Error after the response started: ${mapped.code}`);
      response.end();
      return;
    }

    if (mapped.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(Math.max(0, Math.ceil(mapped.retryAfterSeconds))));
    }
    const body: ApiError = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details !== undefined ? { details: mapped.details } : {}),
      },
    };
    response.status(mapped.status).json(body);
  }
}
