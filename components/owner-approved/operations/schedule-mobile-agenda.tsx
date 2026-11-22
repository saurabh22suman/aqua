"use client";

import { useState } from "react";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { Dialog } from "@/components/ui/Dialog";
import { CalendarEventDetail } from "@/components/owner-calendar/calendar-event-detail";
import { projectionsForDay } from "@/components/owner-calendar/calendar-projection";
import { dayOfMonth, timeRange, weekdayShort } from "@/components/owner-calendar/calendar-layout";
import { eventStatusLabel, type CalendarEvent } from "@/components/owner-calendar/calendar-model";

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
  const visibleDays = view === "agenda" ? days : [selectedDate];
  const hasVisible = visibleDays.some((day) => projectionsForDay(events, day).length > 0);
  return <div className="mt-3 space-y-3">
    {chooserDays.length > 1 ? <nav aria-label="Choose a day" className="flex gap-1 overflow-x-auto">
      {chooserDays.map((day) => {
        const active = day === selectedDate;
        return <Link key={day} href={dayHrefs?.[day] ?? "#"} aria-current={active ? "date" : undefined} className={`relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center rounded-ctl border px-1 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${active ? "border-[var(--accent-strong)] bg-[var(--selected-surface)] text-[var(--selected-ink)]" : "border-line bg-paper text-ink-2"}`}><span>{weekdayShort(day)}</span><strong className="font-medium">{dayOfMonth(day)}</strong><span className="sr-only">{active ? "Selected" : ""}</span></Link>;
      })}
    </nav> : null}
    {!hasVisible ? <p className="rounded-card border border-line bg-paper p-4 text-[13px] text-ink-3">Nothing on this day.</p> : visibleDays.map((day) => {
      const rows = projectionsForDay(events, day);
      if (!rows.length) return null;
      return <div key={day} className="space-y-2"><h3 className="text-[13px] font-medium text-ink-2">{weekdayShort(day)} {dayOfMonth(day)}</h3>
        {rows.map(({ event }) => {
          const location = event.detail.find((item) => item.label === "Location")?.value ?? "No location";
          return <article key={`${day}:${event.id}`} aria-label={`${event.title} at ${location}`} className="rounded-card border border-line bg-paper">
            <button type="button" onClick={() => setOpenId(event.id)} className="flex min-h-11 w-full items-start gap-3 rounded-card p-[18px] text-left">
              <time dateTime={event.startsAt} className="w-20 flex-none text-[12px] font-medium text-ink-2">{timeRange(event.startMinutes, event.durationMinutes)}</time>
              <span className="min-w-0 flex-1"><span className="block break-words text-[14px] font-medium text-ink">{event.title}</span><span className="mt-1 block text-[12px] text-ink-3">{event.resourceLabel}</span><span className="mt-1 block text-[12px] text-ink-2">{event.capacityLabel} · {eventStatusLabel(event.status)}</span></span>
            </button>
          </article>;
        })}
      </div>;
    })}
    <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setOpenId(null); }} title={selected?.title ?? ""}>
      {selected ? <CalendarEventDetail event={selected} categoryLabels={labels} /> : null}
    </Dialog>
  </div>;
}
