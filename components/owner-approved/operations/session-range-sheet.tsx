"use client";

import { useState } from "react";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { Dialog } from "@/components/ui/Dialog";

export type SessionRangeKey = "today" | "week" | "all";
export type SessionRange = { key: SessionRangeKey; label: string; end: string };

const shortDates = new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", timeZone: "UTC",
});
const fullDates = new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});

export function SessionRangeSheet({
  ranges,
  from,
  selected,
  onSelect,
}: {
  ranges: SessionRange[];
  from: string;
  selected: SessionRangeKey;
  onSelect: (range: SessionRangeKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = ranges.find(range => range.key === selected) ?? ranges[0]!;
  const first = new Date(from);

  return (
    <>
      <button type="button" className="owner-period-pill min-w-0"
        aria-label={`Session dates, ${active.label}, ${fullDates.formatRange(first, new Date(active.end))}`}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <OwnerIcon name="calendar" size={17} />
        <span className="min-w-0 flex-1">{shortDates.formatRange(first, new Date(active.end))}</span>
        <OwnerIcon name="down" size={13} />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Session dates" swipeToClose>
        {open ? <div className="grid gap-2" role="group" aria-label="Upcoming date ranges">
          {ranges.map(range => {
            const checked = selected === range.key;
            return (
              <button key={range.key} type="button" aria-pressed={checked}
                onClick={() => { onSelect(range.key); setOpen(false); }}
                className={`flex min-h-14 items-center justify-between gap-3 rounded-ctl border px-3 py-2 text-left ${checked ? "border-[var(--accent-strong)] bg-[var(--selected-surface)] text-[var(--selected-ink)]" : "border-line bg-paper text-ink"}`}>
                <span>
                  <strong className="block text-sm font-semibold">{range.label}</strong>
                  <span className="block text-xs text-ink-2">{fullDates.formatRange(first, new Date(range.end))}</span>
                </span>
                {checked ? <OwnerIcon name="check" size={18} /> : null}
              </button>
            );
          })}
        </div> : null}
      </Dialog>
    </>
  );
}
