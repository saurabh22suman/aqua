/** Existing booking capability is available to pool or court tenants. */
export function hasBookingEntitlement(features: ReadonlySet<string>): boolean {
  return features.has("pool.booking") || features.has("court.booking");
}
