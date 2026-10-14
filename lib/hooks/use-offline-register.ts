import { useEffect, useMemo, useRef, useState } from "react";
import { markAttendanceSessionAction } from "@/lib/actions/coach";
import type { RosterRow } from "@/lib/actions/coach";
import { formatTimeIST } from "@/lib/time/tz";
import { activateOfflineIdentity, storedOfflineIdentity, enqueueMark, kvDelete, kvGet, queueForIdentity,
  queueDelete, scopedKvSet } from "@/lib/offline/idb";
import type { OfflineIdentity } from "@/lib/offline/identity";
import { runOfflineLifecycle } from "@/lib/offline/client-session";

export type Mark = "present" | "absent" | "late";
type LastError = { at: number; message: string };
declare global {
  interface Window { __flushQueue?: () => Promise<void>; __waitForPendingWrites?: () => Promise<void>; }
}

export function useOfflineRegister(sessionId: string, rows: RosterRow[], initialStatuses: Record<string, Mark>,
  offlineSyncEnabled: boolean, identity?: OfflineIdentity | null) {
  const [marks, setMarks] = useState<Record<string, Mark>>(initialStatuses);
  const [pending, setPending] = useState(0), [saving, setSaving] = useState(0);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [lastError, setLastError] = useState<LastError | null>(null);
  const [online, setOnline] = useState(true), [sessionEnded, setSessionEnded] = useState(false);
  const running = useRef(false), inFlight = useRef(0);
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
      for (const entry of await queueForIdentity(identity)) {
        // Server verifies this session-bound scope again before its mutation.
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            markAttendanceSessionAction({ sessionId: entry.sessionId, memberId: entry.memberId,
              status: entry.status, clientId: entry.clientId, offlineScope: identity.scope }),
            new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("Sync timed out. Retry when connected.")), 8000); }),
          ]);
          if (!result.ok) throw new Error(result.error ?? "Could not sync attendance.");
          await queueDelete(entry.clientId);
          const at = Date.now();
          await scopedKvSet(identity, "lastSynced", { at });
          await kvDelete(`${identity.scope}:lastError`);
          setLastSynced(at); setLastError(null);
        } catch (error) {
          fail(error);
          await scopedKvSet(identity, "lastError", { at: Date.now(), message: error instanceof Error ? error.message : String(error) }).catch(() => {});
          await enqueueMark({ ...entry, attempts: entry.attempts + 1 }).catch(() => {});
          break;
        } finally { if (timeout) clearTimeout(timeout); }
      }
      await refreshFromQueue();
    } catch (error) { fail(error); }
    finally { running.current = false; }
  };

  function waitForPendingWrites(): Promise<void> {
    return inFlight.current === 0 ? Promise.resolve() : new Promise(resolve => waiters.current.push(resolve));
  }

  useEffect(() => {
    const connected = () => { setOnline(true); if (offlineAvailable) void flush.current(); };
    const disconnected = () => setOnline(false);
    const ended = () => { setSessionEnded(true); setMarks({}); setPending(0); };
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
        if (error) setLastError(error);
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

  function mark(memberId: string, next: Mark): Promise<void> {
    const clientId = crypto.randomUUID();
    if (!offlineAvailable) {
      if (!navigator.onLine) { fail(new Error("Offline — marking is unavailable until you reconnect.")); return Promise.resolve(); }
      return markAttendanceSessionAction({ sessionId, memberId, status: next, clientId }).then(result => {
        if (!result.ok) { fail(new Error(result.error ?? "Mark failed.")); return; }
        setMarks(current => ({ ...current, [memberId]: next })); setLastError(null); setLastSynced(Date.now());
      }).catch(fail);
    }
    if (sessionEnded) return Promise.resolve();
    inFlight.current++; setSaving(count => count + 1);
    return ensureIdentity().then(active => enqueueMark({ clientId, sessionId, memberId, status: next,
      savedAt: Date.now(), attempts: 0, scope: active.scope, expiresAt: active.expiresAt }))
      .then(() => { setMarks(current => ({ ...current, [memberId]: next })); return refreshFromQueue(); })
      .then(() => { void flush.current(); }).catch(fail).finally(() => {
        inFlight.current--; setSaving(count => count - 1);
        if (!inFlight.current) { const pendingWaiters = waiters.current; waiters.current = []; for (const done of pendingWaiters) done(); }
      });
  }
  const markedCount = useMemo(() => Object.values(marks).filter(Boolean).length, [marks]);
  return { marks, mark, markedCount, pending, online, saving, waitForPendingWrites,
    savedAtLabel: lastSynced ? formatTimeIST(new Date(lastSynced)) : null,
    hasActiveFailure: lastError !== null && (!lastSynced || lastError.at > lastSynced),
    retrySync: () => flush.current(), offlineAvailable, sessionEnded };
}
