import { MIN_AGE } from '../constants';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a strict YYYY-MM-DD calendar date (UTC). Returns null for impossible dates like 2001-02-30. */
export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** Full years elapsed between dob and now (UTC calendar). */
export function calculateAge(dob: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function isAdult(dob: Date, now: Date = new Date(), minAge: number = MIN_AGE): boolean {
  return calculateAge(dob, now) >= minAge;
}
