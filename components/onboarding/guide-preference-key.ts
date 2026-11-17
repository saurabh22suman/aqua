import { createHash } from "node:crypto";

/** Display-only device preference. Never use this key to authorize a request. */
export function guidePreferenceKey(tenantId: string, userId: string | null, role: string): string | undefined {
  if (!userId) return undefined;
  return createHash("sha256").update(JSON.stringify([tenantId, userId, role])).digest("hex");
}
