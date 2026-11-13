import { normaliseToE164 } from "./phone";

/** Strict contact shape after trimming, shared by the server and form. */
export function isContactPhoneValid(value: string): boolean {
  const phone = value.trim();
  return phone.length <= 20 && /^[+\d\s()-]+$/.test(phone) && /^\+[1-9]\d{7,14}$/.test(normaliseToE164(phone));
}

/** The form trims optional member and guardian phones before validation. */
export function isOptionalContactPhoneValid(value: string): boolean {
  const phone = value.trim();
  return phone === "" || isContactPhoneValid(phone);
}
