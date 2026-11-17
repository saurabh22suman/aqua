/** Describe only the authorized batch matched by id; never infer from the picker. */
export function enrolmentFacilityLabel(
  batchId: string,
  batches: ReadonlyArray<{ id: string; locationId: string | null; locationName: string | null }>,
): string {
  const batch = batches.find((item) => item.id === batchId);
  if (!batch) return "Facility unavailable";
  if (batch.locationId === null) return "Club-wide";
  return batch.locationName?.trim() || "Facility unavailable";
}
