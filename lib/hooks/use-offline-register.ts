import { useEffect, useMemo, useRef, useState } from "react";
import { markAttendanceSessionAction } from "@/lib/actions/coach";
import type { RosterRow } from "@/lib/actions/coach";
import { formatTimeIST } from "@/lib/time/tz";
import { activateOfflineIdentity, storedOfflineIdentity, enqueueMark, kvDelete, kvGet, queueForIdentity,
  scopedQueueDelete, scopedKvSet } from "@/lib/offline/idb";
import type { OfflineIdentity } from "@/lib/offline/identity";
import { runOfflineLifecycle } from "@/lib/offline/client-session";
import { replayAttendance } from "@/lib/offline/replay";

export type Mark = "present" | "absent" | "late";
type LastError = { at: number; message: string };
type MarkWrite = { clientId: string; status: Mark; pending: boolean; error: string | null };
declare global {
  interface Window { __flushQueue?: () => Promise<void>; __waitForPendingWrites?: () => Promise<void>; }
}

export function useOfflineRegister(sessionId: string, rows: RosterRow[], initialStatuses: Record<string, Mark>,
  offlineSyncEnabled: boolean, identity?: OfflineIdentity | null) {
  const [marks, setMarks] = useState<Record<string, Mark>>(initialStatuses);
  const [pending, setPending] = useState(0);
  const [markWrites, setMarkWrites] = useState<Record<string, MarkWrite | undefined>>({});
  const [retryable, setRetryable] = useState(0);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [lastError, setLastError] = useState<LastError | null>(null);
  const [review, setReview] = useState<Array<{ clientId: string; memberId: string }>>([]);
  const [online, setOnline] = useState(true), [sessionEnded, setSessionEnded] = useState(false);
  const running = useRef(false), inFlight = useRef(new Set<string>());
  const waiters = useRef<Array<() => void>>([]);
  const offlineAvailable = offlineSyncEnabled && Boolean(identity && identity.expiresAt > Date.now());
  const fail = (error: unknown) => setLastError({ at: Date.now(), message: error instanceof Error ? error.message : String(error) });

  async function ensureIdentity(): Promise<OfflineIdentity> {
    return runOfflineLifecycle(async () => {
    if (!identity || identity.expiresAt <= Date.now()) throw new Error("Your offline session ended. Sign in again.");
    const active = await storedOfflineIdentity();
    // A cached component can never replace another session's storage scope.
    if (active && active.scope !== identity.scope) throw new Error("Offline storage is switching sessions. Retry when connected.");
    if (!active && !await activateOfflineIdentity(identity)) throw new Error("Your offline session ended. Sign in again.");
    return identity;
    });
  }

  async function refreshFromQueue() {
    if (!identity) return;
    const mine = (await queueForIdentity(identity)).filter(entry => entry.sessionId === sessionId);
    setPending(mine.length);
    const blocked = new Set<string>();
    let available = 0;
    for (const entry of mine) {
      if (entry.review) blocked.add(entry.memberId);
      else if (!blocked.has(entry.memberId)) available++;
    }
    setRetryable(available);
    setReview(mine.filter(entry => entry.review).map(({ clientId, memberId }) => ({ clientId, memberId })));
    if (mine.length) setMarks(current => {
      const next = { ...current };
      for (const entry of mine) next[entry.memberId] = entry.status;
      return next;
    });
  }

  const flush = useRef(async () => {});
  flush.current = async () => {
    if (running.current || !navigator.onLine || !offlineAvailable || !identity) return;
    running.current = true;
    try {
      const result = await replayAttendance(identity);
      if (result.lastSyncedAt !== undefined) {
        await scopedKvSet(identity, "lastSynced", { at: result.lastSyncedAt });
        setLastSynced(result.lastSyncedAt);
      }
      if (result.error) fail(new Error(result.error));
      else { await kvDelete(`${identity.scope}:lastError`); setLastError(null); }
      await refreshFromQueue();
    } catch (error) { fail(error); }
    finally { running.current = false; }
  };

  function waitForPendingWrites(): Promise<void> {
    return inFlight.current.size === 0 ? Promise.resolve() : new Promise(resolve => waiters.current.push(resolve));
  }

  useEffect(() => {
    const connected = () => { setOnline(true); if (offlineAvailable) void flush.current(); };
    const disconnected = () => setOnline(false);
    const ended = () => { setSessionEnded(true); setMarks({}); setPending(0); setRetryable(0); setReview([]); setMarkWrites({}); };
    const cleared = (event: Event) => {
      if (identity && (event as CustomEvent<{ scope: string }>).detail?.scope === identity.scope) ended();
    };
    const changed = (event: Event) => {
      if (identity && (event as CustomEvent<{ scope: string | null }>).detail?.scope !== identity.scope) ended();
    };
    window.addEventListener("online", connected); window.addEventListener("offline", disconnected);
    window.addEventListener("aqua-offline-cleared", cleared);
    window.addEventListener("aqua-offline-identity", changed);
    setOnline(navigator.onLine);
    if (offlineAvailable && identity) {
      window.__flushQueue = () => flush.current(); window.__waitForPendingWrites = waitForPendingWrites;
      void ensureIdentity().then(async active => {
        await scopedKvSet(active, `roster:${sessionId}`, { rows, savedAt: Date.now() });
        await refreshFromQueue();
        const last = await kvGet<{ at: number }>(`${active.scope}:lastSynced`);
        if (last) setLastSynced(last.at);
        const error = await kvGet<LastError>(`${active.scope}:lastError`);
        if (error && (!last || error.at >= last.at)) setLastError(error);
      }).catch(fail);
    }
    const tick = setInterval(() => {
      setOnline(navigator.onLine);
      if (identity && identity.expiresAt <= Date.now()) { ended(); return; }
      if (offlineAvailable) void refreshFromQueue().catch(fail).then(() => flush.current());
    }, 4000);
    return () => {
      window.removeEventListener("online", connected); window.removeEventListener("offline", disconnected);
      window.removeEventListener("aqua-offline-cleared", cleared); clearInterval(tick);
      window.removeEventListener("aqua-offline-identity", changed);
      delete window.__flushQueue; delete window.__waitForPendingWrites;
    };
    // The scope/expiry/session identify this register; persisted roster writes
    // are effects, never SSR work. Server props are stable within that scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, identity?.scope, identity?.expiresAt, offlineAvailable]);

  async function mark(memberId: string, status: Mark): Promise<void> {
    if (sessionEnded || inFlight.current.has(memberId)) return;
    const previous = markWrites[memberId];
    const sameMark = previous?.status === status ? previous : undefined;
    const clientId = sameMark?.clientId ?? crypto.randomUUID();
    const writing = { clientId, status, pending: true, error: sameMark?.error ?? null };
    const failed = (error: string) => setMarkWrites(current => ({
      ...current, [memberId]: { ...writing, pending: false, error },
    }));

    inFlight.current.add(memberId);
    setMarkWrites(current => ({ ...current, [memberId]: writing }));
    try {
      if (offlineAvailable) {
        const active = await ensureIdentity();
        await enqueueMark({ clientId, sessionId, memberId, status, savedAt: Date.now(), attempts: 0,
          scope: active.scope, expiresAt: active.expiresAt });
      } else {
        if (!navigator.onLine) {
          failed("Mark did not save. Reconnect to retry.");
          return;
        }
        const result = await markAttendanceSessionAction({ sessionId, memberId, status, clientId });
        if (!result.ok) {
          failed(result.error ? `Mark did not save. ${result.error}` : "Mark did not save. Try again.");
          return;
        }
        setLastSynced(Date.now());
      }
      setMarks(current => ({ ...current, [memberId]: status }));
      setMarkWrites(current => {
        const next = { ...current };
        delete next[memberId];
        return next;
      });
      if (offlineAvailable) {
        // The enqueue has already committed even if its read-back fails.
        setPending(count => count + 1);
        await refreshFromQueue().catch(fail);
        void flush.current();
      }
    } catch {
      failed(offlineAvailable ? "Mark did not save on this device." : "Mark not confirmed. Retry to check and save it.");
    } finally {
      inFlight.current.delete(memberId);
      if (!inFlight.current.size) {
        const pendingWaiters = waiters.current;
        waiters.current = [];
        for (const done of pendingWaiters) done();
      }
    }
  }
  const writeStates = Object.values(markWrites);
  const saving = writeStates.filter(write => write?.pending).length;
  const hasSyncFailure = lastError !== null && retryable > 0;
  const markedCount = useMemo(() => Object.values(marks).filter(Boolean).length, [marks]);
  return { marks, mark, markedCount, pending, retryable, online, saving, waitForPendingWrites, review,
    discardReview: async (clientId: string) => {
      if (!identity) return;
      const memberId = review.find(entry => entry.clientId === clientId)?.memberId;
      if (!memberId || !await scopedQueueDelete(identity, clientId)) return;
      setMarks(current => {
        const next = { ...current };
        if (initialStatuses[memberId]) next[memberId] = initialStatuses[memberId]; else delete next[memberId];
        return next;
      });
      await refreshFromQueue();
    },
    savedAtLabel: lastSynced ? formatTimeIST(new Date(lastSynced)) : null,
    hasActiveFailure: lastError !== null || writeStates.some(write => write?.error),
    hasSyncFailure, markWrites,
    retrySync: () => flush.current(), offlineAvailable, sessionEnded };
}
