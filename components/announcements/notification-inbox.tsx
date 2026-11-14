"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listMyNotificationsAction,
  markNotificationReadAction,
} from "@/lib/actions/announcements";
import type { NotificationRow } from "@/lib/services/announcements";
import { formatDateTimeIST } from "@/lib/time/tz";

// U-06 — the signed-in user's in-app notifications with read state.
// The service already filters by the caller's user id; this island
// only renders and marks read.

export function NotificationInbox({ initial }: { initial: NotificationRow[] }) {
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const marking = useRef(false);

  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await listMyNotificationsAction();
      if (request === generation.current) {
        setRows(next);
        setError(null);
      }
    } catch {
      if (request === generation.current) setError("Could not refresh notifications. Please retry.");
    }
  }, []);

  useEffect(() => {
    const requests = generation;
    void load();
    return () => { requests.current++; };
  }, [load]);

  async function markRead(id: string) {
    if (marking.current) return;
    marking.current = true;
    generation.current++;
    setBusyId(id);
    setError(null);
    try {
      const result = await markNotificationReadAction(id);
      if (!result.ok) {
        setError("Could not mark this notification as read. Please retry.");
        return;
      }
      await load();
    } catch {
      setError("Could not confirm whether this notification was marked read. Refresh or retry.");
    } finally {
      marking.current = false;
      setBusyId(null);
    }
  }

  const unread = rows.filter((r) => !r.readAt).length;

  return (
    <section className="min-w-0 rounded-card border border-line bg-paper p-5 [overflow-wrap:anywhere]">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Your notifications
        </h2>
        <span className="text-[12px] text-ink-3">
          {unread > 0 ? `${unread} unread` : "All read"}
        </span>
      </header>
      {error ? (
        <div className="mt-2 text-[12.5px] text-ink-2">
          <p role="alert">{error}</p>
          <button type="button" disabled={busyId !== null} onClick={() => void load()} className="min-h-11 underline underline-offset-2">Retry refresh</button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          Nothing yet. Announcements sent to you appear here.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p
                  className={`text-[13.5px] ${
                    row.readAt ? "font-normal text-ink-2" : "font-medium text-ink"
                  }`}
                >
                  {row.title}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] text-ink-3">
                  {row.body}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  {formatDateTimeIST(row.createdAt)}
                </p>
              </div>
              {row.readAt ? (
                <span className="flex-none text-[11px] text-ink-3">Read</span>
              ) : (
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void markRead(row.id)}
                  className="inline-flex min-h-11 flex-none items-center justify-center rounded-pill border border-line px-3 py-1.5 text-[12px] text-ink-2"
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
