// Canonical JSON serialisation for digests and byte-stable exports.
//
// `JSON.stringify` is not canonical: key order follows insertion order,
// so the same logical value can serialise two ways depending on how the
// driver parsed it. Two consumers depend on stability:
//
//   * E-03's audit checkpoint digest — jsonb key order must never
//     change the HMAC;
//   * E-06's activity export — re-running the same day must produce
//     byte-identical NDJSON.
//
// Rules: object keys sorted recursively; arrays keep their order;
// Date/BigInt normalised to JSON-safe values; timestamps rendered by
// `toISOString()` (fixed UTC millisecond format) whether the input is a
// Date from the driver or an ISO string from an older manifest.

export function fixedTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `canonical-json: unparseable timestamp value ${JSON.stringify(value)}`,
    );
  }
  return date.toISOString();
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
