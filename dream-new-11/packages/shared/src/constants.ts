export const BRAND = {
  name: 'Dream New 11',
  tagline: 'Create Your Team. Play Your Game.',
  colors: {
    bg: '#0A1128',
    card: '#121C3D',
    accent: '#22E06B',
    text: '#FFFFFF',
    muted: '#8A94B8',
  },
} as const;

/** Minimum age to register. Enforced on client and server. */
export const MIN_AGE = 18;

/** Fixed OTP accepted only when APP_MODE=demo. */
export const DEMO_OTP = '123456';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 30;
export const OTP_MAX_ATTEMPTS = 5;

export const APP_MODES = ['demo', 'production'] as const;
export type AppMode = (typeof APP_MODES)[number];

export const USER_ROLES = ['USER', 'SUPER_ADMIN', 'CONTENT_ADMIN', 'SUPPORT', 'FINANCE'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'SELF_EXCLUDED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const OTP_PURPOSES = ['LOGIN', 'RESET_PASSWORD'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];
