import { resolveRequestedFacility } from "@/lib/facility";

/** Resolve URL precedence without turning malformed selections into all sites. */
export function resolveOwnerFacility(input: {
  facility?: string;
  location?: string;
  cookie?: string;
}): { ok: true; facilityId?: string } | { ok: false } {
  const scope = resolveRequestedFacility(input);
  return scope.valid ? { ok: true, facilityId: scope.facilityId } : { ok: false };
}

/** Explicit all prevents a destination from silently adopting a cookie. */
export function ownerFacilityHref(path: string, facilityId?: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}facility=${encodeURIComponent(facilityId ?? "all")}`;
}
