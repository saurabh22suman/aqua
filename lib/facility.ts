import { z } from "zod";

// W1-6 continuation — the owner facility filter, made one concept.
// The switcher writes the choice to a cookie (so it follows the owner
// across pages that have no explicit `?facility=` in their link) and
// to the URL (so links are shareable and server pages read it first).
// Pages resolve `searchParams.facility` first, then the cookie.
//
// Only a well-formed UUID is ever accepted; data services combine the
// value with the standard O-08 location predicate, so a forged value
// for a location the caller cannot see returns no rows rather than
// widening access.

export const FACILITY_COOKIE = "aqua_facility";

const facilitySchema = z.string().uuid();

export function parseFacilityValue(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = facilitySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function resolveFacilityValue(
  searchParam: string | null | undefined,
  cookieValue: string | null | undefined,
): string | undefined {
  return parseFacilityValue(searchParam) ?? parseFacilityValue(cookieValue);
}

// Routes that render the switcher. `/owner` is exact (its children are
// listed explicitly); the rest match by prefix. Pages with no facility
// dimension (settings, announcements, staff directory, onboarding)
// intentionally do not show the control — a picker that changes
// nothing is the bug being fixed.
export const FACILITY_SCOPED_PATH_PREFIXES = [
  "/owner/members",
  "/owner/fees",
  "/owner/programs",
  "/owner/reports",
] as const;

export function isFacilityScopedPath(pathname: string): boolean {
  if (pathname === "/owner") return true;
  return FACILITY_SCOPED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
