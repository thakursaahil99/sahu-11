import { z } from 'zod';
import { MIN_AGE, OTP_LENGTH } from '../constants';
import { isAdult, parseIsoDate } from '../utils/age';
import { normalizePhone } from '../utils/phone';

export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid mobile number' });
      return z.NEVER;
    }
    return phone;
  });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }));

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`);

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(40, 'Name must be at most 40 characters')
  // \p{M} admits combining marks, e.g. the Devanagari vowel signs in "राहुल".
  .regex(/^[\p{L}][\p{L}\p{M} .'-]*$/u, "Name can only contain letters, spaces, . ' -");

/** YYYY-MM-DD, a real calendar date, not in the future, and the user is at least MIN_AGE. */
export const dobSchema = z.string().superRefine((value, ctx) => {
  const date = parseIsoDate(value);
  if (!date || date.getTime() > Date.now() || date.getUTCFullYear() < 1900) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid date of birth' });
    return;
  }
  if (!isAdult(date)) {
    ctx.addIssue({ code: 'custom', message: `You must be ${MIN_AGE} or older to play` });
  }
});

const acceptTermsSchema = z.literal(true, { message: 'Please accept the Terms & Privacy Policy' });

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
});

/** Completes signup after phone OTP verification; signupToken proves phone ownership. */
export const registerPhoneSchema = z.object({
  signupToken: z.string().min(10),
  name: nameSchema,
  dob: dobSchema,
  email: emailSchema.optional(),
  acceptTerms: acceptTermsSchema,
});

export const registerEmailSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
  dob: dobSchema,
  acceptTerms: acceptTermsSchema,
});

export const loginEmailSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(72),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
  password: passwordSchema,
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20),
});

export type RequestOtpInput = z.input<typeof requestOtpSchema>;
export type VerifyOtpInput = z.input<typeof verifyOtpSchema>;
export type RegisterPhoneInput = z.input<typeof registerPhoneSchema>;
export type RegisterEmailInput = z.input<typeof registerEmailSchema>;
export type LoginEmailInput = z.input<typeof loginEmailSchema>;
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;
export type RefreshTokenInput = z.input<typeof refreshTokenSchema>;
