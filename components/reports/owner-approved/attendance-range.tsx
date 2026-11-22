"use client";
import { useState } from "react";
import { DateField } from "@/components/ui/DateField";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

export function AttendanceRange({ period, from, to, facility }: { period: string; from: string; to: string; facility?: string }) {
  const [selected, setSelected] = useState(period);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  return <form action="/owner/reports/attendance" className="mt-4 flex flex-wrap items-end gap-3">
    <label className="grid gap-1 text-sm text-ink-2">Range
      <Select name="period" value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="last7">Last 7 days</option><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom dates</option>
      </Select>
    </label>
    {selected === "custom" ? <fieldset className="w-full min-w-0">
      <legend className="sr-only">Custom dates</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <div className="grid min-w-0 gap-1 text-sm text-ink-2"><label htmlFor="attendance-from">From</label><DateField id="attendance-from" value={start} onChange={setStart} required calendarLabel="Choose start date" /><input type="hidden" name="from" value={start} /></div>
        <div className="grid min-w-0 gap-1 text-sm text-ink-2"><label htmlFor="attendance-to">To</label><DateField id="attendance-to" value={end} onChange={setEnd} required calendarLabel="Choose end date" /><input type="hidden" name="to" value={end} /></div>
      </div>
    </fieldset> : null}
    {facility ? <input type="hidden" name="facility" value={facility} /> : null}
    <Button type="submit" variant="secondary">Apply</Button>
  </form>;
}
