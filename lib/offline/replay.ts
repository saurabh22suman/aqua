import { markAttendanceSessionAction } from "@/lib/actions/coach";
import type { OfflineIdentity } from "./identity";
import { enqueueMark, queueForIdentity, scopedQueueDelete, storedOfflineIdentity } from "./idb";
import { clearOfflineData } from "./client-session";

/** One origin-wide writer; without native cross-tab locks we fail closed. */
export async function replayAttendance(identity: OfflineIdentity, timeoutMs = 8000): Promise<{ error: string | null; lastSyncedAt?: number }> {
  if (!navigator.locks) return { error: "Sync is unavailable in this browser. Keep this page open and reconnect on a supported device." };
  let lastSyncedAt: number | undefined;
  const outcome = (error: string | null) => lastSyncedAt === undefined ? { error } : { error, lastSyncedAt };
  const work = navigator.locks.request("aqua-attendance-replay", { ifAvailable: true }, async lock => {
    if (!lock) return outcome("Sync is already in progress.");
    const blocked = new Set<string>();
    for (const entry of await queueForIdentity(identity)) {
      const active = await storedOfflineIdentity();
      if (!active || active.scope !== identity.scope || active.expiresAt <= Date.now()) return outcome("Your offline session ended. Sign in again.");
      const target = `${entry.sessionId}:${entry.memberId}`;
      if (blocked.has(target)) continue;
      if (entry.review) { blocked.add(target); continue; }
      try {
        // Never time out this promise: the request is not cancellable, and the
        // lock must remain held until it settles to prevent a later correction
        // racing an earlier request whose server outcome is still unknown.
        const result = await markAttendanceSessionAction({ sessionId: entry.sessionId, memberId: entry.memberId,
          status: entry.status, clientId: entry.clientId, offlineScope: identity.scope });
        if (!result.ok) {
          if (result.code === "reauth") {
            await clearOfflineData(identity.scope);
            return outcome(result.error ?? "Your offline session ended. Sign in again.");
          }
          if (result.code !== "terminal") return outcome(result.error ?? "Could not sync attendance.");
          await enqueueMark({ ...entry, review: true });
          blocked.add(target);
          continue;
        }
        if (!await scopedQueueDelete(identity, entry.clientId)) return outcome("Your offline session ended. Sign in again.");
        lastSyncedAt = Date.now();
      } catch { return outcome("Could not sync attendance. Retry when connected."); }
    }
    return outcome(null);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<ReturnType<typeof outcome>>(resolve => {
      timer = setTimeout(() => resolve(outcome("Sync timed out. Retry when connected.")), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
