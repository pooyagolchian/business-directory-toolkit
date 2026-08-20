// `/max` metadata is required: the default (`min`) build does not carry the
// number-type ranges needed to tell a UAE landline from a mobile.
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export type PhoneType = "landline" | "mobile" | "unknown";

export interface NormalizedPhone {
  /** Exactly as the API returned it, so a listing stays auditable. */
  raw: string;
  /** E.164, e.g. "+97145776680". */
  e164: string;
  type: PhoneType;
}

/**
 * The Google Maps engine returns UAE phone numbers in local format
 * ("04 577 6680", "052 253 3290"), never E.164. Everything downstream — the
 * phone-lookup index especially — needs a single canonical form.
 *
 * Returns null rather than guessing when the number is unparseable or belongs
 * to another country.
 */
export function normalizePhone(
  raw: string | null | undefined,
): NormalizedPhone | null {
  if (!raw || raw.trim() === "") return null;

  const parsed = parsePhoneNumberFromString(raw, "AE");

  // `country !== "AE"` matters: a +44 number parses as valid GB, and coercing
  // it into +971 would silently corrupt the index.
  if (!parsed || !parsed.isValid() || parsed.country !== "AE") return null;

  const kind = parsed.getType();
  const type: PhoneType =
    kind === "MOBILE"
      ? "mobile"
      : kind === "FIXED_LINE"
        ? "landline"
        : "unknown";

  return { raw, e164: parsed.number, type };
}
