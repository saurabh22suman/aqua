"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { CalendarEventDetail } from "@/components/owner-calendar/calendar-event-detail";
import { projectionsForDay } from "@/components/owner-calendar/calendar-projection";
import { dayGap, dayOfMonth, minutesToClock, weekdayShort } from "@/components/owner-calendar/calendar-layout";
import { eventStatusLabel, type CalendarEvent } from "@/components/owner-calendar/calendar-model";
import { formatWallTime12h, formatWeekdayDateIST } from "@/lib/time/tz";

const sessionCount = (count: number) => `${count} session${count === 1 ? "" : "s"}`;

export function ScheduleMobileAgenda({ events, days, chooserDays = days, selectedDate, dayHrefs, labels, view }: {
  events: CalendarEvent[];
  days: string[];
  chooserDays?: string[];
  selectedDate: string;
  dayHrefs?: Record<string, string>;
  labels: { batch: string; booking: string };
  view: "day" | "week" | "agenda";
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = events.find((event) => event.id === openId) ?? null;
  const schedule = new Map(days.map((day) => [day, projectionsForDay(events, day)]));
  const visibleDays = (view === "agenda" ? days : [selectedDate]).filter((day) => schedule.get(day)?.length);
  const next = days.find((day) => day > selectedDate && schedule.get(day)?.length && dayHrefs?.[day]);
  const nextHref = next ? dayHrefs?.[next] : undefined;

  // Date navigation uses real documents so the date, scoped counts and
  // agenda arrive together even if a client calendar transition stalls.

  return (
    <div className="mt-3 space-y-3">
      {chooserDays.length > 1 ? (
        <nav aria-label="Choose a day" className="owner-planner-week">
          {chooserDays.map((day) => {
            const active = day === selectedDate;
            const count = schedule.get(day)?.length;
            const label = formatWeekdayDateIST(day);
            return (
              <a key={day} href={dayHrefs?.[day] ?? "#"} aria-current={active ? "date" : undefined}
                aria-label={count === undefined ? label : `${label}, ${sessionCount(count)}`}
                className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center rounded-ctl border text-[12px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)] ${active ? "border-[var(--accent-strong)] bg-[var(--selected-surface)] text-[var(--selected-ink)]" : "border-line bg-paper text-ink-2"}`}>
                <span>{weekdayShort(day)}</span>
                <strong className="font-medium tabular-nums">{dayOfMonth(day)}</strong>
                {count === undefined ? null : <span aria-hidden="true" className="text-[10.5px] tabular-nums">{count}</span>}
                {active ? <span className="sr-only">Selected</span> : null}
              </a>
            );
          })}
        </nav>
      ) : null}
      {visibleDays.length === 0 ? (
        <div role="group" className="rounded-card border border-line bg-paper p-4" aria-label="Schedule for the selected dates">
          <p className="text-[14px] font-medium text-ink">{view === "agenda" ? "No sessions this week." : "Nothing on this day."}</p>
          {next && nextHref ? <a href={nextHref} className="mt-1 inline-flex min-h-11 items-center text-[13px] font-medium text-water">Next day with sessions · {formatWeekdayDateIST(next)}</a> : null}
        </div>
      ) : visibleDays.map((day) => {
        const rows = schedule.get(day) ?? [];
        return (
          <div role="group" key={day} className="space-y-2" aria-label={formatWeekdayDateIST(day)}>
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <h3 className="text-[13px] font-medium text-ink">{formatWeekdayDateIST(day)}</h3>
              <span className="text-[12px] text-ink-3">{sessionCount(rows.length)}</span>
            </div>
            {rows.map(({ event }) => {
              const location = event.detail.find((item) => item.label === "Location")?.value ?? "No location";
              const endMinutes = event.startMinutes + event.durationMinutes;
              const overnightDays = dayGap(event.startMinutes, endMinutes);
              return (
                <article key={event.id} aria-label={`${event.title} at ${location}`} className="rounded-card border border-line bg-paper">
                  <button type="button" onClick={() => setOpenId(event.id)} className="flex min-h-11 w-full items-start gap-3 rounded-card p-4 text-left hover:bg-deck/40">
                    <time dateTime={event.startsAt} className="owner-planner-time">
                      <span className="block whitespace-nowrap">{formatWallTime12h(minutesToClock(event.startMinutes))}</span>
                      <span className="block whitespace-nowrap text-[11px]">– {formatWallTime12h(minutesToClock(endMinutes))}</span>
                      {overnightDays > 0 ? <span className="block text-[11px]">(+{overnightDays}d)</span> : null}
                    </time>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[14px] font-medium text-ink">{event.title}</span>
                      <span className="mt-1 block text-[12px] text-ink-3">{event.resourceLabel}</span>
                      <span className="mt-1 block text-[12px] text-ink-2">{event.capacityLabel} · {eventStatusLabel(event.status)}</span>
                    </span>
                  </button>
                </article>
              );
            })}
          </div>
        );
      })}
      <Dialog className="owner-planner-sheet" open={selected !== null} onOpenChange={(open) => { if (!open) setOpenId(null); }} title={selected?.title ?? ""}>
        {selected ? <CalendarEventDetail event={selected} categoryLabels={labels} /> : null}
      </Dialog>
    </div>
  );
}
