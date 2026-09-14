// Activity kinds — shared by the service and the client managers.
// Closed set, fixed for every tenant (design §8): which kind a row is,
// is data; the set itself is code.

export const ACTIVITY_KINDS = [
  "pool",
  "court",
  "turf",
  "studio",
  "field",
  "counter",
  "table",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  pool: "Pool",
  court: "Court",
  turf: "Turf",
  studio: "Studio",
  field: "Field",
  counter: "Café counter",
  table: "Table",
};
