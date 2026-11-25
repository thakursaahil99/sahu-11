import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { defaultScoringFor, ScoringRules } from '@dream11/shared';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_MS = 30_000;

/**
 * Points tables per sport + format. Rows are created from the shared defaults on first use;
 * admins edit them in Phase 8, and edits apply from the next scoring tick.
 */
@Injectable()
export class ScoringConfigService {
  private readonly cache = new Map<string, { rules: ScoringRules; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async rulesFor(sportId: string, format: string): Promise<ScoringRules> {
    const key = `${sportId}:${format}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.rules;
    const row = await this.prisma.scoringConfig.upsert({
      where: { sportId_format: { sportId, format } },
      create: { sportId, format, rules: defaultScoringFor(format) as unknown as Prisma.InputJsonObject },
      update: {},
    });
    // Merge over defaults so a partially edited row still has every field.
    const rules = { ...defaultScoringFor(format), ...(row.rules as Partial<ScoringRules>) };
    this.cache.set(key, { rules, at: Date.now() });
    return rules;
  }

  /** After an admin edit: the next scoring tick uses the new table. */
  invalidate(): void {
    this.cache.clear();
  }
}
