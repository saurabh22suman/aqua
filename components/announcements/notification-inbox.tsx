"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listMyNotificationsAction,
  markNotificationReadAction,
} from "@/lib/actions/announcements";
import type { NotificationRow } from "@/lib/services/announcements";
import { formatDateTimeIST } from "@/lib/time/tz";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";

// U-06 — the signed-in user's in-app notifications with read state.
// The service already filters by the caller's user id; this island
// only renders and marks read.

export function NotificationInbox({ initial, workday = false, allowUnreadFilter = false }: { initial: NotificationRow[]; workday?: boolean; allowUnreadFilter?: boolean }) {
  const [rows, setRows] = useState(initial);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const marking = useRef(false);
  const status = useRef<HTMLParagraphElement>(null);
  const focusAfterMark = useRef(false);

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

  useEffect(() => {
    if (!focusAfterMark.current) return;
    focusAfterMark.current = false;
    status.current?.focus();
  }, [rows]);

  async function markRead(id: string, button: HTMLButtonElement) {
    if (marking.current) return;
    const hasFocus = (workday || allowUnreadFilter) && document.activeElement === button;
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
      const readAt = new Date().toISOString();
      focusAfterMark.current = hasFocus && (document.activeElement === button || document.activeElement === document.body);
      setRows((current) => current.map((row) => row.id === id ? { ...row, readAt } : row));
      await load();
    } catch {
      setError("Could not confirm whether this notification was marked read. Refresh or retry.");
    } finally {
      marking.current = false;
      setBusyId(null);
    }
  }

  const unread = rows.filter((r) => !r.readAt);
  const earlier = rows.filter((r) => r.readAt);

  function noticeList(items: NotificationRow[]) {
    const Title = workday ? "h4" : "p";
    return (
      <ul className="mt-2 divide-y divide-line">
        {items.map((row) => (
          <li key={row.id} className={workday ? "min-w-0 py-3" : "flex items-start justify-between gap-3 py-2.5"}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Title className={workday ? "min-w-0 text-sm font-semibold text-ink" : `text-[13.5px] ${row.readAt ? "font-normal text-ink-2" : "font-medium text-ink"}`}>{row.title}</Title>
                {workday && row.readAt ? <StatusBadge tone="neutral">Read</StatusBadge> : null}
              </div>
              <p className={workday ? "mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-2" : "mt-0.5 whitespace-pre-wrap text-[12.5px] text-ink-3"}>{row.body}</p>
              <time className={workday ? "mt-1 block text-xs text-ink-3" : "mt-0.5 block text-[11px] text-ink-3"} dateTime={row.createdAt}>{formatDateTimeIST(row.createdAt)}</time>
            </div>
            {row.readAt ? (!workday ? <span className="flex-none text-[11px] text-ink-3">Read</span> : null) : workday ? (
              <Button type="button" variant="secondary" size="sm" className="mt-2" disabled={busyId !== null}
                aria-label={`${busyId === row.id ? "Marking" : "Mark"} ${row.title} as read`}
                onClick={(event) => void markRead(row.id, event.currentTarget)}>
                {busyId === row.id ? "Marking…" : "Mark read"}
              </Button>
            ) : (
              <button type="button" disabled={busyId !== null} onClick={(event) => void markRead(row.id, event.currentTarget)}
                className="inline-flex min-h-11 flex-none items-center justify-center rounded-pill border border-line px-3 py-1.5 text-[12px] text-ink-2">
                Mark read
              </button>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-label="Your notifications" className={`min-w-0 rounded-card border border-line bg-paper [overflow-wrap:anywhere] ${workday ? "p-4" : "p-5"}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          {workday ? "Your inbox" : "Your notifications"}
        </h2>
        <p role="status" ref={status} tabIndex={workday || allowUnreadFilter ? -1 : undefined} className={workday ? "text-[13px] font-medium text-ink-2" : "text-xs text-ink-3"}>
          {unread.length > 0 ? `${unread.length} unread` : workday ? rows.length > 0 ? "All caught up" : "0 unread" : "All read"}
        </p>
      </header>
      {error ? (
        <div className="mt-2 text-[12.5px] text-ink-2">
          <p role="alert">{error}</p>
          <button type="button" disabled={busyId !== null} onClick={() => void load()} className="min-h-11 underline underline-offset-2">Retry refresh</button>
        </div>
      ) : null}

      {allowUnreadFilter ? (
        <div role="group" aria-label="Inbox view" className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={unreadOnly ? "secondary" : "primary"} aria-pressed={!unreadOnly}
            onClick={() => setUnreadOnly(false)}>All updates</Button>
          <Button type="button" size="sm" variant={unreadOnly ? "primary" : "secondary"} aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly(true)}>Unread only</Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        workday && error ? null : <p className="mt-2 text-sm text-ink-2">
          Nothing yet. Announcements sent to you appear here.
        </p>
      ) : workday ? (
        <>
          {unread.length > 0 ? (
            <section aria-label="Unread announcements" className="mt-3 border-t border-line pt-3">
              <h3 className="text-xs font-semibold text-ink-2">Unread announcements</h3>
              {noticeList(unread)}
            </section>
          ) : null}
          {earlier.length > 0 ? (
            <section aria-label="Previously read" className="mt-3 border-t border-line pt-3">
              <h3 className="text-xs font-semibold text-ink-2">Previously read</h3>
              {noticeList(earlier)}
            </section>
          ) : null}
        </>
      ) : unreadOnly && unread.length === 0 ? <p className="mt-3 text-sm text-ink-2">No unread updates.</p> : noticeList(unreadOnly ? unread : rows)}
    </section>
  );
}
