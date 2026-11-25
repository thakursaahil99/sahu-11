import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { ApiErrorBody } from '@dream11/shared';
import type { Response } from 'express';

/** Normalises every error into the shared ApiErrorBody shape. Never leaks internals. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) this.logger.error(exception instanceof Error ? exception.stack : exception);
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof ThrottlerException) {
      return { statusCode: 429, error: 'Too Many Requests', message: 'Too many attempts. Please wait and try again.' };
    }
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const error =
        HttpStatus[statusCode]
          ?.toLowerCase()
          .split('_')
          .map((w) => w[0]!.toUpperCase() + w.slice(1))
          .join(' ') ?? 'Error';
      if (typeof response === 'string') return { statusCode, error, message: response };
      const r = response as { message?: string | string[]; fields?: Record<string, string>; code?: string };
      const message = Array.isArray(r.message) ? r.message[0] : r.message;
      return { statusCode, error, message: message ?? exception.message, ...(r.fields ? { fields: r.fields } : {}), ...(r.code ? { code: r.code } : {}) };
    }
    // Body-parser errors (too large, bad JSON, wrong charset) are client errors marked `expose`.
    const e = exception as { status?: unknown; expose?: unknown; type?: unknown };
    if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500 && e.expose === true) {
      const statusCode = e.status;
      const message = e.type === 'entity.too.large' ? 'Request is too large' : e.type === 'entity.parse.failed' ? 'Request body is not valid JSON' : 'Bad request';
      return { statusCode, error: statusCode === 413 ? 'Payload Too Large' : 'Bad Request', message };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      return { statusCode: 409, error: 'Conflict', message: 'This record already exists' };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
      return { statusCode: 404, error: 'Not Found', message: 'Not found' };
    }
    return { statusCode: 500, error: 'Internal Server Error', message: 'Something went wrong. Please try again.' };
  }
}
