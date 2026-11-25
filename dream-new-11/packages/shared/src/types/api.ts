import type { AppMode, UserRole, UserStatus } from '../constants';

export type Language = 'en' | 'hi';

export interface UserSettingsDto {
  pushMatchReminders: boolean;
  pushContestUpdates: boolean;
  pushPromotions: boolean;
  emailUpdates: boolean;
  hapticsEnabled: boolean;
  language: Language;
}

export interface UserDto {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** YYYY-MM-DD */
  dob: string;
  avatarUrl: string | null;
  favouriteTeam: string | null;
  city: string | null;
  /** State of residence code, e.g. "MH". */
  state: string | null;
  role: UserRole;
  status: UserStatus;
  phoneVerified: boolean;
  emailVerified: boolean;
  hasPassword: boolean;
  referralCode: string;
  settings: UserSettingsDto;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export interface AuthResponse {
  user: UserDto;
  tokens: AuthTokens;
}

export interface OtpRequestResponse {
  /** Seconds the client must wait before requesting another code. */
  resendIn: number;
  expiresIn: number;
  /** Present only in demo mode so testers know which code to enter. */
  demoCode?: string;
}

export type VerifyOtpResponse =
  | ({ isNewUser: false } & AuthResponse)
  | { isNewUser: true; signupToken: string; phone: string };

export interface MessageResponse {
  message: string;
}

export interface AppConfigDto {
  appMode: AppMode;
  paidContestsEnabled: boolean;
  minAge: number;
  otpLength: number;
  supportEmail: string;
  termsUrl: string;
  privacyUrl: string;
  /** Public page with the app download (APK / store links). */
  downloadPageUrl: string;
  /** Which push token the app should register: Expo push tokens, raw FCM tokens, or none (push off). */
  pushProvider: 'none' | 'expo' | 'fcm';
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  /** Field-level validation errors keyed by dotted path. */
  fields?: Record<string, string>;
  /** Machine-readable reason, e.g. REAUTH_REQUIRED or MFA_REQUIRED. */
  code?: string;
}
