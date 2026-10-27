import { v5 as uuidv5 } from "uuid";

// Deterministic identities for the demo-history generator.
//
// Every row the generator writes gets a UUIDv5 derived from
// (tenantId, kind, key). Two consequences that matter:
//
//   * a repeat run addresses the SAME row (so the insert conflicts
//     instead of duplicating), and
//   * the ids are stable for a given plan, so a reviewer can read a row
//     id in a summary and find it again.
//
// The namespace is fixed for this tool and never derived from anything
// that changes between runs.

const NAMESPACE = "b7d1c0de-4a6f-4f5e-9a1c-2f7d5e6c8a41";

export function historyId(tenantId: string, kind: string, key: string): string {
  return uuidv5(`${tenantId}:${kind}:${key}`, NAMESPACE);
}

/**
 * A stable 0..1 value for a string. FNV-1a, 32-bit — the same shape the
 * demo seed uses for its attendance mix, so the two generators agree on
 * "same input, same output" without sharing code.
 */
export function hash01(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** A short, stable hex token for readable client ids and references. */
export function hash8(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
