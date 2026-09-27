"use client";

import { useCallback, useEffect, useState } from "react";
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

  const load = useCallback(async () => {
    setRows(await listMyNotificationsAction());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unread = rows.filter((r) => !r.readAt).length;

  return (
    <section className="rounded-card border border-line bg-paper p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">
          Your notifications
        </h2>
        <span className="text-[12px] text-ink-3">
          {unread > 0 ? `${unread} unread` : "All read"}
        </span>
      </header>

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
                  disabled={busyId === row.id}
                  onClick={() => {
                    setBusyId(row.id);
                    void (async () => {
                      await markNotificationReadAction(row.id);
                      await load();
                      setBusyId(null);
                    })();
                  }}
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
