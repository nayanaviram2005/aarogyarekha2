/**
 * A registered number as Twilio needs it: E.164 (+ country code and digits).
 *  - a 10-digit Indian mobile (starts 6 to 9), optionally with 0, 91 or +91 in front, becomes +91XXXXXXXXXX
 *  - a number already written with + and a country code is kept as digits
 *  - anything else is refused: a wrong number must never be guessed at, because the text names a person and their status
 */
export function toE164(raw: string | null | undefined, defaultCountry = '+91'): string | null {
  const t = (raw ?? '').trim(); if (!t) return null;
  const digits = t.replace(/[^0-9]/g, '');
  if (t.startsWith('+')) return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : null;
  const cc = defaultCountry.replace(/[^0-9]/g, '');
  if (cc === '91') {
    const ten = digits.length === 10 ? digits : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : null;
    return ten && /^[6-9][0-9]{9}$/.test(ten) ? `+91${ten}` : null;
  }
  return digits.length >= 8 && digits.length <= 12 ? `+${cc}${digits}` : null;
}
