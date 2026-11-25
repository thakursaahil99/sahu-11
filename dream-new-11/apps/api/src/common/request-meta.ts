import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  /** ISO country from the CDN/proxy header named by GEO_COUNTRY_HEADER (e.g. cf-ipcountry), if configured. */
  country?: string | null;
}

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
    country: process.env.GEO_COUNTRY_HEADER ? (req.get(process.env.GEO_COUNTRY_HEADER)?.slice(0, 2).toUpperCase() ?? null) : null,
  };
});
