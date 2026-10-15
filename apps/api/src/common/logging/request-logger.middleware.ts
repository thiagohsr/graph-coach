import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * One line per request when it finishes: method, path, status, duration, and the user id when the request was
 * authenticated (contracts/http-api.md "Logging rules"). Never the query string, headers, bodies, tokens, or e-mail
 * addresses: the line is built only from these fields.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
      const userId = (req as Request & { user?: { id?: string } }).user?.id;
      this.logger.log(
        `${req.method} ${path} ${res.statusCode} ${ms.toFixed(1)}ms${userId ? ` user=${userId}` : ''}`,
      );
    });
    next();
  }
}
