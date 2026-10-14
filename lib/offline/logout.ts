import { markAttendanceSessionAction } from "@/lib/actions/coach";
import { queueAll, queueDelete, queueForIdentity } from "./idb";
import { readOfflineSessionState } from "./client-session";

export async function syncBeforeLogout(): Promise<number> {
  const pending = await queueAll();
  if (!pending.length || !navigator.onLine) return pending.length;
  try {
    const state = await readOfflineSessionState();
    if (!state.identity) return pending.length;
    for (const entry of await queueForIdentity(state.identity)) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          markAttendanceSessionAction({ sessionId: entry.sessionId, memberId: entry.memberId, status: entry.status,
            clientId: entry.clientId, offlineScope: state.identity.scope }),
          new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("Sync timed out")), 8000); }),
        ]);
        if (!result.ok) break;
        await queueDelete(entry.clientId);
      } finally { if (timeout) clearTimeout(timeout); }
    }
  } catch {
    // A lost response leaves the idempotent mark in the queue. The operator
    // can retry syncing, or explicitly discard local drafts before logout.
  }
  return (await queueAll()).length;
}
