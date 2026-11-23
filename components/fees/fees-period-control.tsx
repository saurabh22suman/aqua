"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { addDays, formatPeriodRangeIST, todayInZone } from "@/lib/time/tz";
import { parseCalendarDate } from "@/lib/time/calendar";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";

// The reporting API uses an exclusive end date; the control asks for an
// inclusive last day so the label matches the days a person chooses.
type PeriodProps = {
  tab: "overview" | "transactions";
  from: string;
  to: string;
  facility?: string;
  timezone: string;
  method?: string;
  group?: string;
  compact?: boolean;
};

export function FeesPeriodControl(props: PeriodProps) {
  return <PeriodForm key={`${props.tab}:${props.from}:${props.to}:${props.facility}:${props.method}:${props.group}`} {...props} />;
}

function PeriodForm({ tab, from, to, facility, timezone, method, group, compact = false }: PeriodProps) {
  const editorId = useId();
  const summaryRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(addDays(to, -1));
  const [error, setError] = useState("");

  function href(first: string, exclusiveTo: string) {
    const params = new URLSearchParams({ tab, from: first, to: exclusiveTo });
    if (facility) params.set("facility", facility);
    if (method) params.set("method", method);
    if (group) params.set("group", group);
    return `/owner/fees?${params.toString()}`;
  }
  function month(offset: number) {
    const today = todayInZone(timezone);
    const [year, monthNumber] = today.split("-").map(Number);
    const first = new Date(Date.UTC(year!, monthNumber! - 1 + offset, 1));
    const next = new Date(Date.UTC(year!, monthNumber! + offset, 1));
    return href(first.toISOString().slice(0, 10), next.toISOString().slice(0, 10));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    if (!parseCalendarDate(start) || !parseCalendarDate(end) || start > end) {
      event.preventDefault();
      setError("Choose a valid date range.");
    }
    // A native GET reloads the server-rendered range and its financial reads
    // together. The heading never claims that an uncommitted draft was applied.
  }

  function closeEditor() {
    setStart(from);
    setEnd(addDays(to, -1));
    setError("");
    setEditing(false);
    if (!compact) summaryRef.current?.querySelector("button")?.focus();
  }

  const editor = <div id={editorId} className={compact ? "space-y-3" : "mt-2 space-y-3 rounded-ctl border border-line p-3"}>
      <div className="flex flex-wrap gap-2">
        <a href={month(0)} className={buttonClasses({variant:"secondary",size:"sm"})}>This month</a>
        <a href={month(-1)} className={buttonClasses({variant:"secondary",size:"sm"})}>Last month</a>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0"><label htmlFor="fees-period-from" className="text-[13px] text-ink-2">From date</label><DateField id="fees-period-from" calendarLabel="Choose from date" value={start} onChange={setStart} required /></div>
        <div className="min-w-0"><label htmlFor="fees-period-through" className="text-[13px] text-ink-2">Through date</label><DateField id="fees-period-through" calendarLabel="Choose through date" value={end} onChange={setEnd} required /></div>
      </div>
      {error ? <p role="alert" className="text-[13px] text-ink-2">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">Apply period</Button>
        <Button type="button" variant="ghost" onClick={closeEditor}>Cancel</Button>
      </div>
    </div>;

  return <form action="/owner/fees" method="get" onSubmit={submit} className="mt-3" aria-label="Collection period">
    <input type="hidden" name="tab" value={tab} />
    <input type="hidden" name="from" value={start} />
    <input type="hidden" name="to" value={parseCalendarDate(end) ? addDays(end, 1) : ""} />
    {facility ? <input type="hidden" name="facility" value={facility} /> : null}
    {method ? <input type="hidden" name="method" value={method} /> : null}
    {group ? <input type="hidden" name="group" value={group} /> : null}
    {compact ? (
      <button type="button" className="owner-period-pill" aria-label="Change dates" aria-haspopup="dialog"
        aria-expanded={editing} onClick={() => { setEditing(true); setError(""); }}>
        <OwnerIcon name="calendar" size={17} />
        <span>{formatPeriodRangeIST(from, to)}</span>
        <OwnerIcon name="down" size={13} />
      </button>
    ) : (
      <div ref={summaryRef} role="group" aria-label="Applied period" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] border border-line bg-paper px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3"><span className="grid h-8 w-8 flex-none place-items-center rounded-[9px] bg-[var(--selected-surface)] text-[var(--accent-ink)]"><OwnerIcon name="calendar" size={17} /></span><div className="min-w-0"><p className="text-[12px] text-ink-3">Applied period</p><p className="text-[13px] font-medium text-ink-2">{formatPeriodRangeIST(from, to)}</p></div></div>
        <button type="button" aria-label="Change dates" aria-expanded={editing} aria-controls={editorId} className="min-h-11 min-w-11 rounded-ctl border border-line bg-paper px-3 text-[13px] font-medium text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]" onClick={() => { setEditing(!editing); setError(""); }}>Change</button>
      </div>
    )}
    {compact ? <Dialog open={editing} onOpenChange={open => { if (!open) closeEditor(); }} title="Payment dates" swipeToClose>
      {editing ? editor : null}
    </Dialog> : editing ? editor : null}
  </form>;
}
