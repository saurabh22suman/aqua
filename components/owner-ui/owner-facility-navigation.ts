import { isFacilityScopedPath, resolveRequestedFacility } from "@/lib/facility";

/** Carry explicit URL scope only; cookies are never read as link authority. */
export function scopedOwnerNavigationHref(href: string, currentPath: string, current: Pick<URLSearchParams, "get">): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const target = new URL(href, "https://owner.invalid");
  if (target.origin !== "https://owner.invalid") return href;
  const path = target.pathname;
  const operations = ["/owner/schedule", "/owner/sessions", "/owner/batches"];
  if (!isFacilityScopedPath(path) && !operations.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) return href;
  // A destination's own explicit choice always wins, including legacy schedule links.
  if (target.searchParams.has("facility") || (path === "/owner/schedule" && target.searchParams.has("location"))) return href;
  const facility = current.get("facility");
  const location = currentPath === "/owner/schedule" ? current.get("location") : null;
  if (facility === null && location === null) return href;
  const requested = resolveRequestedFacility({ facility, location });
  // Preserve an invalid explicit value rather than silently widening to a cookie/all.
  const value = requested.valid ? requested.facilityId ?? "all" : facility ?? location ?? "";
  target.searchParams.set("facility", value);
  return `${target.pathname}${target.search}${target.hash}`;
}
