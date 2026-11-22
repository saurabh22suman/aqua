"use client";

import { useEffect, useState } from "react";

import { listBookingsAction } from "@/lib/actions/bookings";
import type { BookingDayRow } from "@/lib/services/bookings";

// V-04 — the booking desk's READ state.
//
// The desk reads a DAY at a time through the existing authorised
// action. The week view is seven of those reads for the same facility,
// so nothing new is asked of the backend.
//
// The state of a read is kept as three distinct things, because they
// are three different truths:
//
//   * READY with rows — the day or week holds bookings;
//   * READY with no rows — the day or week is genuinely empty;
//   * ERROR — the read failed.
//
// A failed read is never rendered as an empty day: the desk says it
// failed and offers a retry. The rows on screen always belong to the
// scope in the heading, so a move to another day never shows the
// previous day's bookings under the new one.

/**
 * The state of one read.
 *
 * `key` is the IDENTITY of the request the answer belongs to: the
 * date, the facility, the refresh, the retry and whether the read is
 * switched on at all. A stored answer is only "ready" for the very
 * request it answered — a re-activated or refreshed read must not
 * present the previous answer as current, because that answer may
 * hold a booking that has since been cancelled.
 */
export type BookingReadState = {
  key: string;
  status: "ready" | "error";
};

export type BookingRead<T> = {
  rows: T[];
  /** The read is in flight, or has not answered yet. */
  loading: boolean;
  /** The read failed. */
  failed: boolean;
  /** What went wrong, when it failed. */
  error: string | null;
  /** Run the read again. */
  retry: () => void;
};

/**
 * Whether a read's answer still belongs to the request on show.
 *
 * `loading` means the read has not answered for THIS request yet. An
 * answer for another request is not an answer, and it is never shown.
 */
function scopeOf(
  state: BookingReadState | null,
  key: string,
): { ready: boolean; failed: boolean; loading: boolean } {
  const current = state && state.key === key ? state : null;
  return {
    ready: current?.status === "ready",
    failed: current?.status === "error",
    loading: current === null,
  };
}

/**
 * The identity of a read request.
 *
 * A GENERATION is part of it: a read that is switched off and on again
 * — or that is refreshed — is a NEW request even when its inputs are
 * the same, and the previous answer must not be presented as its
 * result.
 */
export type ReadRequest = {
  date: string;
  facilityId: string;
  refreshKey: number;
  attempt: number;
  enabled: boolean;
  generation: number;
};

/**
 * The request a read is currently making.
 *
 * When the inputs change the generation moves on, during the render
 * (React's "adjust the state when the inputs change" pattern), so the
 * stored answer stops being current in the SAME commit — there is no
 * frame in which the previous answer is shown as the new one.
 */
function useReadRequest(args: {
  date: string;
  facilityId: string;
  refreshKey: number;
  attempt: number;
  enabled: boolean;
}): ReadRequest {
  const [request, setRequest] = useState<ReadRequest>({
    ...args,
    generation: 0,
  });
  if (
    request.date !== args.date ||
    request.facilityId !== args.facilityId ||
    request.refreshKey !== args.refreshKey ||
    request.attempt !== args.attempt ||
    request.enabled !== args.enabled
  ) {
    setRequest({ ...args, generation: request.generation + 1 });
  }
  return request;
}

/**
 * The bookings of one day for one facility.
 *
 * `enabled` scopes the read to the surface that shows it: the desk
 * reads a day for the board and for the day view, and never reads a
 * week it is not showing.
 */
export function useBookingDayRead(
  date: string,
  facilityId: string,
  refreshKey: number,
  enabled = true,
): BookingRead<BookingDayRow> {
  const [rows, setRows] = useState<BookingDayRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<BookingReadState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useReadRequest({
    date,
    facilityId,
    refreshKey,
    attempt,
    enabled,
  });
  const key = `${request.generation}`;

  useEffect(() => {
    if (!facilityId || !enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await listBookingsAction({ date, facilityId });
        if (cancelled) return;
        setRows(result);
        // A successful read clears the previous failure: the desk stops
        // saying "the read failed" the moment it works again.
        setState({ key, status: "ready" });
        setError(null);
      } catch {
        if (cancelled) return;
        setRows([]);
        setState({ key, status: "error" });
        setError("Could not load the day board.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [facilityId, date, refreshKey, attempt, enabled, key]);

  const scope = scopeOf(state, key);
  return {
    rows: scope.ready ? rows : [],
    loading: scope.loading,
    failed: scope.failed,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}

/**
 * The bookings of every day of a week, for one facility.
 *
 * `enabled` scopes the read to the week view: the desk never reads
 * seven days behind a day view.
 */
export function useBookingWeekRead(
  week: string[],
  date: string,
  facilityId: string,
  refreshKey: number,
  enabled = true,
): BookingRead<BookingDayRow> {
  const [rows, setRows] = useState<BookingDayRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<BookingReadState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useReadRequest({
    date,
    facilityId,
    refreshKey,
    attempt,
    enabled,
  });
  const key = `${request.generation}`;

  useEffect(() => {
    if (!facilityId || week.length === 0 || !enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          week.map((day) => listBookingsAction({ date: day, facilityId })),
        );
        if (cancelled) return;
        // A booking that runs past midnight is returned by BOTH day
        // reads. It is one booking, so it appears once.
        const unique = new Map<string, BookingDayRow>();
        for (const row of results.flat()) unique.set(row.bookingId, row);
        setRows([...unique.values()]);
        setState({ key, status: "ready" });
        setError(null);
      } catch {
        if (cancelled) return;
        setRows([]);
        setState({ key, status: "error" });
        setError("Could not load the week.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [facilityId, date, week, refreshKey, attempt, enabled, key]);

  const scope = scopeOf(state, key);
  return {
    rows: scope.ready ? rows : [],
    loading: scope.loading,
    failed: scope.failed,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}

/**
 * A read that failed. It says so, and it offers a retry — it never
 * pretends the day or the week was empty.
 */
export function BookingReadError({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <div
      className="mt-4 rounded-card border border-line bg-paper px-4 py-5 text-center"
      data-testid="booking-read-error"
      role="alert"
    >
      <p className="text-[13px] text-ink">
        {message ?? "The booking board could not be loaded."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-ctl border border-line bg-paper px-4 text-[13px] font-medium text-ink-2"
        data-testid="booking-read-retry"
      >
        Try again
      </button>
    </div>
  );
}
