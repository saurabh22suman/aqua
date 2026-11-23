"use client";

import { useId, useRef, useState } from "react";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { addDays } from "@/lib/time/tz";

const fullDate = new Intl.DateTimeFormat("en-IN", {
  weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
});
const shortDate = new Intl.DateTimeFormat("en-IN", {
  weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
});
const shortWeekday = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" });
const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" });

function dateFor(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
}

export function OwnerBriefDate({
  today, selected, onSelect,
}: {
  today: string;
  selected: string;
  onSelect: (day: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  return (
    <header className="owner-collections-date" data-testid="owner-brief-mast" onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }}>
      <div className="owner-collections-date-row">
        <h1>{selected === today ? "Today" : weekday.format(dateFor(selected))}</h1>
        <button
          ref={trigger}
          type="button"
          className="owner-collections-date-button"
          aria-expanded={open}
          aria-controls={id}
          aria-label={`Choose date, ${fullDate.format(dateFor(selected))}`}
          onClick={() => setOpen(value => !value)}
        >
          <time dateTime={selected}>{shortDate.format(dateFor(selected))}</time>
          <OwnerIcon name="down" size={14} />
        </button>
      </div>
      <div id={id} hidden={!open} className="owner-collections-week" role="group" aria-label="Last seven days">
        {dates.map(day => (
          <button
            key={day}
            type="button"
            aria-label={fullDate.format(dateFor(day))}
            aria-current={day === today ? "date" : undefined}
            aria-pressed={day === selected}
            onClick={() => { onSelect(day); close(); }}
          >
            <span aria-hidden="true">{shortWeekday.format(dateFor(day))}</span>
            <strong aria-hidden="true">{Number(day.slice(8))}</strong>
          </button>
        ))}
      </div>
    </header>
  );
}
