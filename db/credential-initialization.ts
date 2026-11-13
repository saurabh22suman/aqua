import { and, eq, isNull, or } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "./client";
import { withPlatform } from "./scope";
import { baAccount } from "./schema/better-auth";
import { platformAuditLog } from "./schema/platform-users";
import type { CREDENTIAL_ISSUER } from "@/lib/services/credentials";

// Called only by the session-gated first-PIN service after hashing. This is
// a global better-auth identity write, not a tenant or Ops-operator action.
// The caller passes the existing pinned credential issuer, never client input.
export async function initializeCredentialPinHash(input: {
  baUserId: string;
  pinHash: string;
  issuer: typeof CREDENTIAL_ISSUER;
}): Promise<boolean> {
  return withPlatform(() => db.transaction(async (tx) => {
    const filled = await tx.update(baAccount)
      .set({ password: input.pinHash, updatedAt: new Date() })
      .where(and(
        eq(baAccount.userId, input.baUserId),
        eq(baAccount.accountId, input.baUserId),
        eq(baAccount.providerId, "credential"),
        eq(baAccount.issuer, input.issuer),
        or(isNull(baAccount.password), eq(baAccount.password, "")),
      ))
      .returning({ id: baAccount.id });
    if (filled.length === 0) {
      const inserted = await tx.insert(baAccount).values({
        id: uuidv7(), userId: input.baUserId, accountId: input.baUserId,
        providerId: "credential", issuer: input.issuer, password: input.pinHash,
      }).onConflictDoNothing().returning({ id: baAccount.id });
      if (inserted.length === 0) return false;
    }
    // actor_id is exclusively an Ops operator FK; target_id is a UUID.
    // A BA principal can have an opaque text ID and no tenant membership.
    // Preserve that identity explicitly without inventing an operator/tenant.
    // The authenticated session supplies this ID. Never record the PIN/hash,
    // phone, session token or request headers. Audit failure aborts the write.
    await tx.insert(platformAuditLog).values({
      action: "credentials.pin_initialized",
      actorId: null, tenantId: null,
      targetType: "better_auth_user", targetId: null,
      detail: {
        principalKind: "better_auth_user", principalId: input.baUserId,
        outcome: "success",
      },
    });
    return true;
  }));
}
