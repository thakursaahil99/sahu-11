/**
 * Normalises a phone number to E.164. A bare 10-digit Indian mobile number
 * gets the +91 prefix; anything else must already carry a country code.
 */
export function normalizePhone(input: string): string | null {
  const cleaned = input.replace(/[\s()-]/g, '');
  if (/^[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^91[6-9]\d{9}$/.test(cleaned)) return `+${cleaned}`;
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) return cleaned;
  return null;
}

export function maskPhone(e164: string): string {
  if (e164.length < 6) return e164;
  return `${e164.slice(0, -10)} ${e164.slice(-10, -8)}••••••${e164.slice(-2)}`;
}
