import { Injectable, NotFoundException } from '@nestjs/common';
import type { FantasyConfig } from '@prisma/client';
import type { FantasyRules } from '@dream11/shared';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_MS = 30_000;

export function toRules(c: FantasyConfig): FantasyRules {
  return {
    teamSize: c.teamSize,
    maxCredits: c.maxCreditsX10 / 10,
    maxPerTeam: c.maxPerTeam,
    roleLimits: {
      WK: { min: c.minWk, max: c.maxWk },
      BAT: { min: c.minBat, max: c.maxBat },
      AR: { min: c.minAr, max: c.maxAr },
      BOWL: { min: c.minBowl, max: c.maxBowl },
    },
    maxTeamsPerMatch: c.maxTeamsPerMatch,
    captainMultiplier: c.captainMultiplierX100 / 100,
    viceCaptainMultiplier: c.viceCaptainMultiplierX100 / 100,
  };
}

/** Team rules per sport. Rows are created with schema defaults on first use; admins edit them in Phase 8. */
@Injectable()
export class FantasyConfigService {
  private readonly cache = new Map<string, { rules: FantasyRules; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async forSport(sportId: string): Promise<FantasyRules> {
    const hit = this.cache.get(sportId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.rules;
    const row = await this.prisma.fantasyConfig.upsert({ where: { sportId }, create: { sportId }, update: {} });
    const rules = toRules(row);
    this.cache.set(sportId, { rules, at: Date.now() });
    return rules;
  }

  async forSportKey(key: string): Promise<FantasyRules> {
    const sport = await this.prisma.sport.findUnique({ where: { key }, select: { id: true } });
    if (!sport) throw new NotFoundException('Unknown sport');
    return this.forSport(sport.id);
  }

  invalidate(sportId: string): void {
    this.cache.delete(sportId);
  }
}
