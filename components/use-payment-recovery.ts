"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PaymentIntentRecovery } from "@/lib/services/payment-intent-recovery";

// F01 — the client half of the durable recovery surface. It reads the
// SERVER's intent state and asks the server to discard a prepared
// attempt. The browser keeps no recovery record of its own; the key is
// held by the caller's in-memory ref as a cache, and the server is the
// source of truth after a reload, another tab or another device.
//
// The read is gated by a monotonically increasing generation: a slow
// empty response for the same target can never overwrite a newer
// committed snapshot. `ready` is true only after the CURRENT target's
// read completed successfully; the forms must not submit before that.

type ListRecovery = (
  input: { targetId: string },
) => Promise<PaymentIntentRecovery>;
type CancelRecovery = (
  input: { intentId: string },
) => Promise<{ ok: boolean; error?: string }>;

const EMPTY: PaymentIntentRecovery = { open: null, lastCommitted: null };
const CHECK_FAILED =
  "Could not check for an earlier attempt. Retry the check before recording.";

export function usePaymentRecovery(
  targetId: string | null | undefined,
  listAction: ListRecovery,
  cancelAction: CancelRecovery,
) {
  const [snapshot, setSnapshot] = useState<{
    targetId: string;
    recovery: PaymentIntentRecovery;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const alive = useRef(true);
  const targetRef = useRef(targetId);
  const readSeq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    targetRef.current = targetId;
    // A target switch starts clean and invalidates every in-flight read:
    // the previous document's open/committed identity must never be used
    // as the next document's key or notice.
    readSeq.current += 1;
    setCheckError(null);
    setCancelError(null);
    setChecking(false);
    setSnapshot(null);
  }, [targetId]);

  const recovery: PaymentIntentRecovery =
    targetId && snapshot?.targetId === targetId
      ? snapshot.recovery
      : EMPTY;
  // The first submit is allowed only after a completed successful read
  // for THIS target. A failed/never-run read is not "nothing found".
  const ready =
    Boolean(targetId) &&
    snapshot?.targetId === targetId &&
    !checking &&
    checkError === null;

  const refresh = useCallback(async (): Promise<PaymentIntentRecovery | null> => {
    const wanted = targetId;
    if (!wanted) {
      readSeq.current += 1;
      setSnapshot(null);
      setCheckError(null);
      setChecking(false);
      return null;
    }
    const seq = readSeq.current + 1;
    readSeq.current = seq;
    setChecking(true);
    setCheckError(null);
    try {
      const next = await listAction({ targetId: wanted });
      if (
        alive.current &&
        targetRef.current === wanted &&
        seq === readSeq.current
      ) {
        setSnapshot({ targetId: wanted, recovery: next });
        return next;
      }
      return null;
    } catch {
      // Keep the last known state; do not pretend the read found
      // nothing. The caller keeps submit blocked and offers Retry check.
      if (
        alive.current &&
        targetRef.current === wanted &&
        seq === readSeq.current
      ) {
        setCheckError(CHECK_FAILED);
      }
      return null;
    } finally {
      if (
        alive.current &&
        targetRef.current === wanted &&
        seq === readSeq.current
      ) {
        setChecking(false);
      }
    }
  }, [listAction, targetId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cancel = useCallback(async (): Promise<boolean> => {
    if (!recovery.open || !targetId) return false;
    setCancelError(null);
    // Invalidate any read that started before the discard; the discard
    // result is authoritative and must not be undone by a stale read.
    readSeq.current += 1;
    try {
      const result = await cancelAction({ intentId: recovery.open.intentId });
      if (!result.ok) {
        setCancelError(result.error ?? "The attempt could not be discarded.");
        // A refused discard can mean the attempt committed, the target moved
        // or the location scope narrowed after the read. Recheck the server
        // instead of leaving the stale "open, no money" snapshot on screen.
        await refresh();
        return false;
      }
      setSnapshot((prev) =>
        prev && prev.targetId === targetId
          ? {
              targetId: prev.targetId,
              recovery: { ...prev.recovery, open: null },
            }
          : prev,
      );
      await refresh();
      return true;
    } catch {
      setCancelError("The attempt could not be discarded. Try again.");
      await refresh();
      return false;
    }
  }, [cancelAction, recovery.open, refresh, targetId]);

  return {
    recovery,
    ready,
    checking,
    checkError,
    cancelError,
    cancel,
    refresh,
  };
}
