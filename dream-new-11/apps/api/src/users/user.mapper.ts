import type { User, UserSettings } from '@prisma/client';
import type { Language, UserDto } from '@dream11/shared';

export type UserWithSettings = User & { settings: UserSettings | null };

export const userInclude = { settings: true } as const;

export function toUserDto(user: UserWithSettings): UserDto {
  const s = user.settings;
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    dob: user.dob.toISOString().slice(0, 10),
    avatarUrl: user.avatarUrl,
    favouriteTeam: user.favouriteTeam,
    city: user.city,
    state: user.state,
    role: user.role,
    status: user.status,
    phoneVerified: user.phoneVerifiedAt !== null,
    emailVerified: user.emailVerifiedAt !== null,
    hasPassword: user.passwordHash !== null,
    referralCode: user.referralCode,
    settings: {
      pushMatchReminders: s?.pushMatchReminders ?? true,
      pushContestUpdates: s?.pushContestUpdates ?? true,
      pushPromotions: s?.pushPromotions ?? false,
      emailUpdates: s?.emailUpdates ?? true,
      hapticsEnabled: s?.hapticsEnabled ?? true,
      language: (s?.language === 'hi' ? 'hi' : 'en') as Language,
    },
    createdAt: user.createdAt.toISOString(),
  };
}
