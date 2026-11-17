import { queueAll } from "./idb";
import { readOfflineSessionState } from "./client-session";
import { replayAttendance } from "./replay";

export async function syncBeforeLogout(): Promise<number> {
  const pending = await queueAll();
  if (!pending.length || !navigator.onLine) return pending.length;
  try {
    const state = await readOfflineSessionState();
    if (!state.identity) return pending.length;
    await replayAttendance(state.identity);
  } catch {
    // A lost response leaves the idempotent mark in the queue. The operator
    // can retry syncing, or explicitly discard local drafts before logout.
  }
  return (await queueAll()).length;
}
