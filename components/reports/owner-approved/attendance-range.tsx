"use client";
import { useState } from "react";
import { OwnerControlSheet } from "@/components/owner-ui/owner-control-sheet";
import { isOwnerPeriodKey, OWNER_PERIOD_TAB_LABEL } from "@/lib/time/owner-period-model";
import { DateField } from "@/components/ui/DateField";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { parseCalendarDate } from "@/lib/time/calendar";
import { addDays, formatPeriodRangeIST } from "@/lib/time/tz";

export function AttendanceRange({ period, from, to, facility, batch, groups = [], compact = false }: { period: string; from: string; to: string; facility?: string; batch?: string; groups?: { id: string; label: string }[]; compact?: boolean }) {
  const [selected, setSelected] = useState(period);
  const [group, setGroup] = useState(batch ?? "");
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const appliedRange = parseCalendarDate(from) && parseCalendarDate(to) && from <= to
    ? formatPeriodRangeIST(from, addDays(to, 1))
    : isOwnerPeriodKey(period) ? OWNER_PERIOD_TAB_LABEL[period] : "Choose dates";
  const form = <form action="/owner/reports/attendance" className={`${compact ? "" : "owner-work-panel mt-4 "}flex flex-wrap items-end gap-3`}>
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
    {groups.length ? (
      <div className="grid min-w-0 gap-1 text-sm text-ink-2">
        <label htmlFor="attendance-group">Attendance group</label>
        <Select id="attendance-group" value={group} onChange={event => setGroup(event.target.value)}>
          <option value="">All groups</option>
          {group && !groups.some(option => option.id === group) ? <option value={group}>Current group</option> : null}
          {groups.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </Select>
      </div>
    ) : null}
    {group ? <input type="hidden" name="batch" value={group} /> : null}
    <Button type="submit" variant="secondary">Apply</Button>
  </form>;
  return compact ? <div className="owner-filter-summary">
    <OwnerControlSheet label="Reporting range" title="Attendance filters" value={appliedRange}>{form}</OwnerControlSheet>
  </div> : form;
}
