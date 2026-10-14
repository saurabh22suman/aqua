import { eq } from "drizzle-orm";
import { db } from "@/db/auth-db";
import { withPlatform } from "@/db/scope";
import { users } from "@/db/schema/users";
import type { UserId } from "@/lib/ids";

// Per-account PIN lockout (2026-09-11 auth feature). Split from
// lib/services/credentials.ts so that file stays under the
// 300-line soft limit; the lockout is a self-contained policy.
//
// 5 failures then a 15-minute lock. Service constants — not columns —
// so they can be tuned without a migration.
export const PIN_LOCKOUT_THRESHOLD = 5;
export const PIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export function isPinLocked(
  pinLockedUntil: Date | null | undefined,
  now = Date.now(),
): boolean {
  return !!pinLockedUntil && pinLockedUntil.getTime() > now;
}

export async function recordPinFailure(userId: UserId): Promise<void> {
  await withPlatform(() => db.transaction(async (tx) => {
    // Serialize increment and lock computation, including expiry races.
    const [user] = await tx
      .select({ attempts: users.failedPinAttempts, lockedUntil: users.pinLockedUntil })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) return;
    const current = user.lockedUntil && !isPinLocked(user.lockedUntil) ? 0 : user.attempts;
    const updated = current + 1;
    const lockedUntil =
      updated >= PIN_LOCKOUT_THRESHOLD
        ? new Date(Date.now() + PIN_LOCKOUT_WINDOW_MS)
        : null;
    await tx
      .update(users)
      .set({ failedPinAttempts: updated, pinLockedUntil: lockedUntil })
      .where(eq(users.id, userId));
  }));
}

export async function clearPinFailures(userId: UserId): Promise<void> {
  await withPlatform(async () => {
    await db
      .update(users)
      .set({ failedPinAttempts: 0, pinLockedUntil: null })
      .where(eq(users.id, userId));
  });
}
