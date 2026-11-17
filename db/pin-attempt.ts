import { eq } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import type { TenantTx } from "./tenant";
import { users } from "./schema/users";
import { isPinLocked, PIN_LOCKOUT_THRESHOLD, PIN_LOCKOUT_WINDOW_MS } from "@/lib/services/pin-lockout";
import type { UserId } from "@/lib/ids";

export type PinAttempt<T> = { ok: true; value: T } | { ok: false };
type PinUser = typeof users.$inferSelect;
type LockedPinUser = Pick<PinUser, "id" | "failedPinAttempts" | "pinLockedUntil">;
class RejectedPinAttempt extends Error {}

// The caller must hold this account's UPDATE lock until the transaction ends.
export async function runPinAttemptInTx<T, U extends LockedPinUser>(
  tx: TenantTx,
  user: U,
  verify: (tx: TenantTx, user: U) => Promise<PinAttempt<T>>,
): Promise<PinAttempt<T>> {
  if (isPinLocked(user.pinLockedUntil)) return { ok: false };
  let result: PinAttempt<T>;
  try {
    result = await tx.transaction(async inner => {
      const verified = await verify(inner, user);
      if (!verified.ok) throw new RejectedPinAttempt();
      return verified;
    });
  } catch { result = { ok: false }; }
  const failures = result.ok ? 0 :
    (user.pinLockedUntil && !isPinLocked(user.pinLockedUntil) ? 0 : user.failedPinAttempts) + 1;
  await tx.update(users).set({
    failedPinAttempts: failures,
    pinLockedUntil: failures >= PIN_LOCKOUT_THRESHOLD ? new Date(Date.now() + PIN_LOCKOUT_WINDOW_MS) : null,
  }).where(eq(users.id, user.id));
  return result;
}

// Hold the account lock through verification and bookkeeping. A savepoint
// rolls back a failed verifier's writes without rolling back its attempt.
// Authentication adapters must use this tx, never acquire a second pool slot.
export async function runPinAttempt<T>(
  subject: { phone: string } | { userId: UserId },
  verify: (tx: TenantTx, user: PinUser) => Promise<PinAttempt<T>>,
): Promise<PinAttempt<T>> {
  return withPlatform(() => db.transaction(async tx => {
    const [user] = await tx.select().from(users).where(
      "phone" in subject ? eq(users.phone, subject.phone) : eq(users.id, subject.userId),
    ).for("update");
    if (!user) return { ok: false };
    return runPinAttemptInTx(tx, user, verify);
  }));
}
