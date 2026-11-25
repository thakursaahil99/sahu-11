import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates and transforms a request part with a shared zod schema. */
export class ZodValidationPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;

    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw new BadRequestException({
      message: Object.values(fields)[0] ?? 'Invalid request',
      fields,
    });
  }
}

export const zodBody = <T extends ZodType>(schema: T) => new ZodValidationPipe(schema);
export const zodQuery = zodBody;
