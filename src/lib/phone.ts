import { ValidationError } from "./errors";

const GHANA_COUNTRY_CODE = "233";

/**
 * Normalise a user-supplied Ghanaian phone number to E.164 (`+233XXXXXXXXX`).
 *
 * People type their number every way imaginable — `024 123 4567`,
 * `+233-24-123-4567`, `(233) 241234567` — and a Guardian Circle is worthless
 * if one member's alert silently goes to a malformed number. Every entry point
 * funnels through here so a single stored form is compared against.
 *
 * Ghanaian mobile numbers are always 9 national-significant digits beginning
 * with 2. Rejecting anything else catches typos and, importantly, stops a
 * malformed entry from silently eating an emergency SMS.
 *
 * @throws ValidationError when the input is not a plausible Ghanaian mobile number.
 */
export const normalizeGhanaPhone = (raw: string, fieldName: string): string => {
  const stripped = raw.replace(/[\s\-().]/g, "");

  let national: string;
  if (stripped.startsWith("+233")) {
    national = stripped.slice(4);
  } else if (stripped.startsWith("233") && stripped.length === GHANA_COUNTRY_CODE.length + 9) {
    national = stripped.slice(GHANA_COUNTRY_CODE.length);
  } else if (stripped.startsWith("0")) {
    national = stripped.slice(1);
  } else {
    national = stripped;
  }

  if (!/^2\d{8}$/.test(national)) {
    throw new ValidationError(
      `${fieldName} must be a valid Ghanaian mobile number, for example 024 123 4567.`,
      { fieldName },
    );
  }

  return `+${GHANA_COUNTRY_CODE}${national}`;
};

/** Non-throwing variant for validating form input before a round trip. */
export const isValidGhanaPhone = (raw: string): boolean => {
  try {
    normalizeGhanaPhone(raw, "phone");
    return true;
  } catch {
    return false;
  }
};

/** Compact form for SMS bodies, where every character costs money. */
export const toCompactPhone = (e164: string): string => e164.replace(/^\+/, "");
