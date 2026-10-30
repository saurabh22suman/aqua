// The shared owner calendar — the desktop time grid.
//
// A Teams/Google-Calendar style week or day: a time ruler down the
// left, one column per day, and every event placed at the minute it
// starts and sized by the time it lasts. Two events that overlap are
// given their own columns so neither hides the other.
//
// The grid is the DESKTOP view. On a phone the same events are listed
// as an agenda (owner-calendar-agenda.tsx) — a seven-column time grid
// is not readable at 390px and would need sideways scrolling, which
// this product does not do.

import { useEffect, useRef, useState } from "react";
import {
  dayOfMonth,
  detectClashes,
  layoutDay,
  minutesToClock,
  weekdayShort,
} from "./calendar-layout";
import { projectOntoDays } from "./calendar-projection";
import { CalendarBlock } from "./owner-calendar-block";
import { OwnerCalendarAgenda } from "./owner-calendar-agenda";
import { formatDateIST, formatWallTime12h } from "@/lib/time/tz";
import type {
  CalendarCategory,
  CalendarEvent,
  CalendarGeometry,
} from "./calendar-model";

export type OwnerCalendarGridProps = {
  /** The days on show, in order. One day or seven. */
  days: string[];
  events: CalendarEvent[];
  geometry: CalendarGeometry;
  /** The day the phone agenda and the highlight follow. */
  selectedDate: string | null;
  /** The current day, when the surface knows it. */
  todayDate: string | null;
  /** Minutes from midnight "now", when today is on show. */
  currentMinutes: number | null;
  categoryLabels: Record<CalendarCategory, string>;
  onSelectEvent: (event: CalendarEvent) => void;
};

export function OwnerCalendarGrid({
  days,
  events,
  geometry,
  selectedDate,
  todayDate,
  currentMinutes,
  categoryLabels,
  onSelectEvent,
}: OwnerCalendarGridProps) {
  // Every day gets the part of every event that falls inside it: a
  // session that runs past midnight contributes its continuation to the
  // next day's track, beside the events that start after midnight.
  const projections = projectOntoDays(events, days);
  // The clashes of the WHOLE range, not of one day: a session that
  // runs past midnight can clash with one that starts after midnight.
  const clashing = detectClashes(events);
  const trackHeight =
    (geometry.dayEndMinutes - geometry.dayStartMinutes) *
    geometry.pixelsPerMinute;
  // Hour labels for the ruler. A label whose clock repeats an earlier
  // one is skipped: a window that spans a whole day would otherwise
  // print "00:00" twice, at the top and at the bottom.
  const hours: number[] = [];
  const seenClocks = new Set<string>();
  for (
    let minute = geometry.dayStartMinutes;
    minute <= geometry.dayEndMinutes;
    minute += 60
  ) {
    const clock = minutesToClock(minute);
    if (seenClocks.has(clock)) continue;
    seenClocks.add(clock);
    hours.push(minute);
  }
  const weekLayout = days.length > 1;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const firstDay = days[0];

  useEffect(() => {
    const element = trackRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = (entries?: ResizeObserverEntry[]) => {
      const width =
        entries?.[0]?.contentRect.width ??
        element.getBoundingClientRect().width;
      if (width > 0) setTrackWidth(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [days.length, firstDay]);

  const isNarrow = (entry: { columns: number }) =>
    trackWidth > 0 && trackWidth / entry.columns - 4 < 44;

  const placedByDay = days.map((day) => ({
    day,
    placed: layoutDay(projections.get(day) ?? [], geometry, clashing),
  }));
  const companion = placedByDay.flatMap(({ day, placed }) =>
    placed
      .filter((entry) => entry.height < 44 || isNarrow(entry))
      .map((entry) => ({ day, entry })),
  );
  const shortKeys = new Set(
    companion.map(({ day, entry }) => `${day}:${entry.event.id}`),
  );

  return (
    <div>
      {companion.length > 0 ? (
        <section
          className="mb-3 rounded-card border border-line bg-paper p-3"
          data-testid="calendar-short-events"
          aria-label="Short events with full-size access"
        >
          <h3 className="font-display text-[13px] font-semibold text-ink">
            More events
          </h3>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            Open short or overlapping events here. The timeline shows their
            scheduled times.
          </p>
          <div className="mt-2 space-y-2">
            {days.map((day) => {
              const rows = companion.filter((entry) => entry.day === day);
              if (rows.length === 0) return null;
              return (
                <div key={day}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
                    {formatDateIST(day)}
                  </p>
                  <OwnerCalendarAgenda
                    projections={rows.map(({ entry }) => {
                      const projection = (projections.get(day) ?? []).find(
                        (candidate) => candidate.event.id === entry.event.id,
                      );
                      return {
                        event: entry.event,
                        startMinutes:
                          projection?.startMinutes ?? entry.event.startMinutes,
                        durationMinutes:
                          projection?.durationMinutes ??
                          entry.event.durationMinutes,
                      };
                    })}
                    categoryLabels={categoryLabels}
                    onSelectEvent={onSelectEvent}
                    day={day}
                    useProjectionTime
                  />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      <div className="relative" data-testid="calendar-grid">
      {geometry.dayStartMinutes < 6 * 60 ? (
        <span
          data-testid="calendar-working-start"
          className="pointer-events-none absolute inset-x-0"
          style={{
            top:
              (6 * 60 - geometry.dayStartMinutes) *
              geometry.pixelsPerMinute,
            scrollMarginTop: 96,
          }}
          aria-hidden="true"
        />
      ) : null}
      {/* The time ruler. It is decorative for a screen reader — the
          event blocks and the agenda carry the same times as text. */}
      <div
        className="pointer-events-none absolute left-0 top-14 z-10 hidden w-14 md:block"
        data-testid="calendar-ruler"
        aria-hidden="true"
      >
        {hours.map((minute) => (
          <span
            key={minute}
            className="absolute right-2 -translate-y-1/2 text-[10.5px] tabular-nums text-ink-3"
            style={{
              top: (minute - geometry.dayStartMinutes) * geometry.pixelsPerMinute,
            }}
          >
            {formatWallTime12h(minutesToClock(minute))}
          </span>
        ))}
      </div>

      <div
        className={
          weekLayout
            ? "md:grid md:grid-cols-7 space-y-4 md:space-y-0 md:gap-0 md:pl-14"
            : "md:grid md:grid-cols-1 space-y-4 md:space-y-0 md:gap-0 md:pl-14"
        }
      >
        {days.map((day, dayIndex) => {
          const placed = placedByDay.find((entry) => entry.day === day)?.placed ?? [];
          const isToday = todayDate === day;
          const isSelected = selectedDate === day;
          return (
            <section
              key={day}
              className="md:border-l md:border-line"
              aria-label={`${weekdayShort(day)} ${dayOfMonth(day)}`}
            >
              <header
                className={`flex h-14 flex-col justify-center gap-0.5 px-2 ${
                  isSelected ? "bg-deck" : ""
                }`}
              >
                <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                  {weekdayShort(day)}
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="font-display text-[15px] font-semibold tabular-nums">
                    {dayOfMonth(day)}
                  </span>
                  {isToday ? (
                    <span className="text-[11px] font-medium text-ink-2">
                      Today
                    </span>
                  ) : null}
                </span>
              </header>

              <div
                className="relative"
                style={{ height: trackHeight }}
                ref={dayIndex === 0 ? trackRef : undefined}
                data-testid="calendar-track"
                data-date={day}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(to bottom, transparent 0, transparent 59px, var(--border-subtle) 59px, var(--border-subtle) 60px)",
                  }}
                  aria-hidden="true"
                />

                {isToday && currentMinutes !== null &&
                currentMinutes >= geometry.dayStartMinutes &&
                currentMinutes <= geometry.dayEndMinutes ? (
                  <div
                    className="absolute inset-x-0 z-20 h-px bg-[var(--accent-strong)]"
                    style={{
                      top:
                        (currentMinutes - geometry.dayStartMinutes) *
                        geometry.pixelsPerMinute,
                    }}
                    data-testid="calendar-now"
                    aria-hidden="true"
                  />
                ) : null}

                {placed.map((entry) => (
                  <CalendarBlock
                    key={entry.event.id}
                    placed={entry}
                    categoryLabels={categoryLabels}
                    onSelect={onSelectEvent}
                    interactive={!shortKeys.has(`${day}:${entry.event.id}`)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      </div>
    </div>
  );
}
