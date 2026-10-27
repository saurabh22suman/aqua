// The shared owner calendar — the composition.
//
// One calendar, two owner surfaces: the schedule (batch sessions) and
// the booking desk (bookings). The calendar owns the SHAPE — the
// ruler, the columns, the agenda and the detail panel — and the
// calling surface owns the MEANING: the words, the rows in the detail
// panel, and which resource is exclusive.
//
// Views: a day column grid on a desktop, an agenda on a phone. Both
// show the same events, so the shape never decides what the owner can
// see.
//
// The toolbar above the calendar is a shared component too
// (owner-calendar-toolbar.tsx), so a surface can put the calendar on a
// page beside its own controls without a second control system.

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { CalendarEventDetail } from "./calendar-event-detail";
import { OwnerCalendarAgenda } from "./owner-calendar-agenda";
import { OwnerCalendarGrid } from "./owner-calendar-grid";
import {
  dayOfMonth,
  resolveGeometry,
  wallClock,
  weekdayShort,
} from "./calendar-layout";
import { projectionsForDay } from "./calendar-projection";
import {
  DEFAULT_GEOMETRY,
  type CalendarCategory,
  type CalendarEvent,
  type CalendarGeometry,
} from "./calendar-model";

export type OwnerCalendarProps = {
  events: CalendarEvent[];
  /** The days on show, in order. */
  days: string[];
  /** The day the agenda and the column highlight follow. */
  selectedDate: string | null;
  /** Today in the academy's own timezone. */
  todayDate: string | null;
  /**
   * The shape on show.
   *
   * "day" and "week" are the time ruler. "agenda" is the same events
   * as a list: a short session's block is exactly as tall as the
   * session, so the list is where a small event still has a full-size
   * target.
   */
  view: "day" | "week" | "agenda";
  /** Where each day opens, when the surface drives the day view by URL. */
  dayHrefs?: Record<string, string>;
  /** Client-driven day selection, for a surface whose state is local. */
  onSelectDay?: (date: string) => void;
  /** The words for the two kinds of event. */
  labels: Record<CalendarCategory, string>;
  /** The working window; it grows when an event falls outside it. */
  geometry?: CalendarGeometry;
  empty: {
    title: string;
    body: string;
    action?: { label: string; href: string };
  };
  /** Actions the owning surface offers inside the detail panel. */
  renderEventActions?: (event: CalendarEvent) => React.ReactNode;
};

export function OwnerCalendar({
  events,
  days,
  selectedDate,
  todayDate,
  view,
  dayHrefs,
  onSelectDay,
  labels,
  geometry,
  empty,
  renderEventActions,
}: OwnerCalendarProps) {
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [now, setNow] = useState<{ date: string; minutes: number } | null>(
    null,
  );

  // The open event is DERIVED from the current events, never a snapshot
  // of an old one. A session that is cancelled, moved or removed closes
  // the panel; one whose state changes is shown with its new state.
  const openEvent = useMemo(
    () => events.find((event) => event.id === openEventId) ?? null,
    [events, openEventId],
  );

  // The clock is read after hydration: a server render and a client
  // render must not disagree about what time it is.
  useEffect(() => {
    const read = () => {
      const clock = wallClock(new Date().toISOString());
      setNow({ date: clock.date, minutes: clock.minutes });
    };
    read();
    const timer = setInterval(read, 60_000);
    return () => clearInterval(timer);
  }, []);

  const activeDate = selectedDate ?? days[0] ?? null;
  const resolved = useMemo(
    () => resolveGeometry(events, geometry ?? DEFAULT_GEOMETRY, days),
    [events, geometry, days],
  );
  // The agenda shows what TOUCHES the selected day: an event that
  // started the night before and is still running belongs to today.
  const agendaEvents = activeDate
    ? projectionsForDay(events, activeDate)
    : [];
  const hasEvents = events.length > 0;

  return (
    <div className="mt-4" data-testid="owner-calendar">
      {days.length > 1 ? (
        <div
          className="mt-3 flex flex-wrap gap-1.5 md:hidden"
          data-testid="calendar-day-strip"
        >
          {days.map((day) => {
            const href = dayHrefs?.[day];
            const active = day === activeDate;
            const chip = (
              <>
                <span className="block text-[10px] uppercase tracking-[0.08em] text-ink-3">
                  {weekdayShort(day)}
                </span>
                <span className="block text-[14px] font-medium tabular-nums">
                  {dayOfMonth(day)}
                </span>
              </>
            );
            const className = `flex min-h-11 min-w-11 flex-col items-center justify-center rounded-ctl border px-2 ${
              active
                ? "border-[var(--accent-strong)] bg-paper text-ink"
                : "border-line bg-paper text-ink-2"
            }`;
            if (href) {
              return (
                <Link
                  key={day}
                  href={href}
                  aria-current={active ? "date" : undefined}
                  className={className}
                >
                  {chip}
                </Link>
              );
            }
            if (onSelectDay) {
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-pressed={active}
                  className={className}
                  data-testid={`calendar-day-${day}`}
                >
                  {chip}
                </button>
              );
            }
            return (
              <span key={day} className={className}>
                {chip}
              </span>
            );
          })}
        </div>
      ) : null}

      {!hasEvents ? (
        <div
          className="mt-4 rounded-card border border-line bg-paper"
          data-testid="calendar-empty"
        >
          <EmptyState
            title={empty.title}
            body={empty.body}
            action={empty.action}
          />
        </div>
      ) : view === "agenda" ? (
        // The agenda on show: EVERY day on the range, each event with
        // a full-size target.
        <div className="mt-4 space-y-4" data-testid="calendar-agenda-days">
          {days.map((day) => {
            const dayProjections = projectionsForDay(events, day);
            if (dayProjections.length === 0) return null;
            return (
              <div key={day}>
                <h3 className="font-display text-[13px] font-semibold text-ink-2">
                  {weekdayShort(day)} {dayOfMonth(day)}
                </h3>
                <OwnerCalendarAgenda
                  projections={dayProjections}
                  categoryLabels={labels}
                  onSelectEvent={(event) => setOpenEventId(event.id)}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="mt-4 hidden md:block">
            <OwnerCalendarGrid
              days={days}
              events={events}
              geometry={resolved}
              selectedDate={activeDate}
              todayDate={todayDate}
              currentMinutes={
                now && now.date === todayDate ? now.minutes : null
              }
              categoryLabels={labels}
              onSelectEvent={(event) => setOpenEventId(event.id)}
            />
          </div>
          <div className="mt-4 md:hidden">
            {agendaEvents.length > 0 ? (
              <OwnerCalendarAgenda
                projections={agendaEvents}
                categoryLabels={labels}
                onSelectEvent={(event) => setOpenEventId(event.id)}
              />
            ) : (
              <p className="rounded-card border border-line bg-paper px-4 py-6 text-center text-[13px] text-ink-3">
                Nothing on this day.
              </p>
            )}
          </div>
        </>
      )}

      <Dialog
        open={openEvent !== null}
        onOpenChange={(open) => {
          if (!open) setOpenEventId(null);
        }}
        title={openEvent?.title ?? ""}
      >
        {openEvent ? (
          <CalendarEventDetail
            event={openEvent}
            categoryLabels={labels}
            actions={renderEventActions?.(openEvent)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
