import { useEffect, useMemo, useRef, useState } from "react";
import { markAttendanceSessionAction } from "@/lib/actions/coach";
import type { RosterRow } from "@/lib/actions/coach";
import {
  enqueueMark,
  kvDelete,
  kvGet,
  kvSet,
  queueAll,
  queueDelete,
  type QueueEntry,
} from "@/lib/offline/idb";

export type Mark = "present" | "absent" | "late";
type LastError = { at: number; message: string };

declare global {
  interface Window {
    // Test hook only — lets scripts/e2e-offline.ts trigger a sync attempt
    // deterministically instead of racing the 4s interval.
    __flushQueue?: () => Promise<void>;
  }
}

// The offline queue/sync state machine for one register screen. Split out
// of components/register-board.tsx (which stayed presentational) purely to
// keep both files under the 300-line rule — this isn't reused elsewhere.
export function useOfflineRegister(
  sessionId: string,
  rows: RosterRow[],
  initialStatuses: Record<string, Mark>,
) {
  const [marks, setMarks] = useState<Record<string, Mark>>(initialStatuses);
  const [pending, setPending] = useState(0);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [lastError, setLastError] = useState<LastError | null>(null);
  const [online, setOnline] = useState(true);
  const runningRef = useRef(false);

  // Re-reads the whole queue and recomputes state scoped to THIS session —
  // the queue is shared across every session a coach has visited offline,
  // but a register screen must only ever show what's true for its own
  // roster, never a total from elsewhere.
  async function refreshFromQueue() {
    const all = await queueAll();
    const mine = all.filter((e) => e.sessionId === sessionId);
    setPending(mine.length);

    // The reload-while-offline case: a hard refresh re-mounts this
    // component from whatever the server (or the service worker's cached
    // shell) rendered, which reflects the DB at that moment — not marks
    // still sitting unsynced in the queue. Overlay the queue on top of the
    // server's rows so nothing a coach already marked appears to have
    // vanished. Queue entries are newer than the server render by
    // definition (they exist because they haven't synced yet), so they
    // win.
    if (mine.length > 0) {
      setMarks((current) => {
        const next = { ...current };
        for (const e of mine) next[e.memberId] = e.status;
        return next;
      });
    }
  }

  const flush = useRef(async () => {
    if (runningRef.current || !navigator.onLine) return;
    runningRef.current = true;
    try {
      for (;;) {
        const entries = await queueAll();
        const entry: QueueEntry | undefined = entries[0];
        if (!entry) break;

        try {
          const res = await Promise.race([
            markAttendanceSessionAction({
              sessionId: entry.sessionId,
              memberId: entry.memberId,
              status: entry.status,
              clientId: entry.clientId,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("sync timed out")), 8000),
            ),
          ]);
          if (!res.ok) throw new Error(res.error ?? "sync failed");
          await queueDelete(entry.clientId);
          await kvSet("lastSynced", { at: Date.now() });
          await kvDelete("lastError");
          setLastError(null);
          setLastSynced(Date.now());
        } catch (err) {
          // Fail LOUD: recorded to durable storage and reflected in the UI
          // as a distinct state (never folded into "syncing" or "offline")
          // — a mark that silently stops trying is worse than one that
          // visibly won't go through. Requeued with the SAME clientId
          // (idb.enqueueMark upserts on it), so retrying never duplicates
          // and never regenerates the idempotency key.
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[aqua] sync attempt failed:", err);
          entry.attempts += 1;
          await enqueueMark(entry);
          const e = { at: Date.now(), message };
          await kvSet("lastError", e);
          setLastError(e);
          break;
        }
      }
      await refreshFromQueue();
      const ls = await kvGet<{ at: number }>("lastSynced");
      if (ls) setLastSynced(ls.at);
    } finally {
      runningRef.current = false;
    }
  });

  useEffect(() => {
    window.__flushQueue = () => flush.current();

    void kvGet<{ at: number }>("lastSynced").then((ls) => {
      if (ls) setLastSynced(ls.at);
    });
    void kvGet<LastError>("lastError").then((e) => {
      if (e) setLastError(e);
    });
    void refreshFromQueue();

    const goOnline = () => {
      setOnline(true);
      void flush.current();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    setOnline(navigator.onLine);

    const tick = setInterval(() => {
      setOnline(navigator.onLine);
      void refreshFromQueue();
      if (navigator.onLine) void flush.current();
    }, 4000);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useMemo(() => {
    void kvSet(`roster:${sessionId}`, { rows, savedAt: Date.now() });
  }, [sessionId, rows]);

  // Returns a promise a caller CAN await (a test, or a future
  // navigation guard) — previously this fired the write inside a
  // detached, unawaited `void (async () => {...})()` IIFE, so nothing
  // could ever observe whether the write had actually landed, and an
  // exception from enqueueMark became a silent unhandled rejection
  // (issue #4). Callers in the UI still don't await it — a click
  // handler can't block a real navigation regardless — but the write
  // itself is now a single connected chain, not a fire-and-forget one.
  function mark(memberId: string, next: Mark): Promise<void> {
    // Idempotency key: generated on-device, before any network call, and
    // never regenerated for this mark — retries reuse the same clientId
    // (see flush(), above), which is what makes replay safe against the
    // (tenant_id, session_id, member_id) upsert in the register service.
    const clientId = crypto.randomUUID();

    setMarks((m) => ({ ...m, [memberId]: next }));

    return enqueueMark({
      clientId,
      sessionId,
      memberId,
      status: next,
      savedAt: Date.now(),
      attempts: 0,
    })
      .then(() => refreshFromQueue())
      .then(() => {
        void flush.current();
      });
  }

  const markedCount = useMemo(
    () => Object.values(marks).filter(Boolean).length,
    [marks],
  );

  const syncedLabel = lastSynced
    ? new Date(lastSynced).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "never";

  // A failure only counts as "current" if nothing has synced since it
  // happened — otherwise a stale error from an hour ago would keep
  // showing red forever even though sync recovered.
  const hasActiveFailure =
    lastError !== null && (!lastSynced || lastError.at > lastSynced);

  return { marks, mark, markedCount, pending, online, syncedLabel, hasActiveFailure };
}
