import { eq } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import { sha256 } from "./platform-auth-crypto";
import { platformSessions, platformUsers, platformAuditLog } from "./schema";

export type PlatformSessionLookup =
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "unauthenticated"; userId: string; role: "admin" | "viewer" }
  | { kind: "authenticated"; userId: string; role: "admin" | "viewer" };

export async function lookupPlatformSession(
  sessionToken: string,
): Promise<PlatformSessionLookup> {
  if (!sessionToken) return { kind: "not_found" };
  const tokenHash = sha256(sessionToken);
  return withPlatform(async () => {
    const [row] = await db
      .select({
        session: platformSessions,
        user: platformUsers,
      })
      .from(platformSessions)
      .innerJoin(platformUsers, eq(platformUsers.id, platformSessions.userId))
      .where(eq(platformSessions.tokenHash, tokenHash))
      .limit(1);
    if (!row) return { kind: "not_found" } as const;
    if (row.user.status !== "active") return { kind: "not_found" } as const;
    if (row.session.expiresAt.getTime() < Date.now()) {
      return { kind: "expired" } as const;
    }
    if (!row.session.secondFactorPassed) {
      return {
        kind: "unauthenticated",
        userId: row.user.id,
        role: row.user.role as "admin" | "viewer",
      };
    }
    // Track operator activity without extending the fixed expiry set when
    // the authenticator challenge completed.
    await db
      .update(platformSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(platformSessions.id, row.session.id));
    return {
      kind: "authenticated",
      userId: row.user.id,
      role: row.user.role as "admin" | "viewer",
    };
  });
}

/**
 * Removes the platform session and records the sign-out.
 *
 * The PUBLIC signature is unchanged (`Promise<void>`): the protected tier1
 * suite asserts `resolves.toBeUndefined()`, and a signature change would
 * break it for no functional gain. The caller that needs to know whether
 * anything was removed uses `platformLogoutWithResult` below.
 */
export async function platformLogout(sessionToken: string): Promise<void> {
  await platformLogoutWithResult(sessionToken);
}

/**
 * The same sign-out, reporting whether a session was really removed.
 *
 * TRUE when a session was removed (the domain `platform.logout` event was
 * written in the same transaction as the deletion) and FALSE when there was
 * nothing to remove — an unknown or already-revoked token. The caller
 * records a truthful NOOP operation event for the false case: a no-op
 * sign-out is never presented as a successful sign-out.
 */
export async function platformLogoutWithResult(
  sessionToken: string,
): Promise<{ removed: boolean }> {
  if (!sessionToken) return { removed: false };
  const tokenHash = sha256(sessionToken);
  // The session row names the operator it belonged to, so the sign-out
  // can record its actor. RETURNING hands that id back from the same
  // statement that removes the row.
  //
  // One transaction: the deletion and the audit row commit together, so
  // a failed audit leaves the session alive instead of recording a
  // sign-out that did not happen.
  const removed = await withPlatform(() =>
    db.transaction(async (tx) => {
      const deleted = await tx
        .delete(platformSessions)
        .where(eq(platformSessions.tokenHash, tokenHash))
        .returning({ userId: platformSessions.userId });
      const revoked = deleted[0];
      // Nothing was deleted (an unknown or already-revoked token):
      // there is no sign-out to record.
      if (!revoked) return false;
      await tx.insert(platformAuditLog).values({
        action: "platform.logout",
        actorId: revoked.userId,
        createdAt: new Date(),
      });
      return true;
    }),
  );
  // The transaction's own answer decides the NOOP: discarding it would
  // report a sign-out for a token that removed nothing.
  return { removed };
}
