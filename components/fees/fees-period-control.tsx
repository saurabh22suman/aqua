"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { addDays, todayInZone } from "@/lib/time/tz";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";

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
};

export function FeesPeriodControl(props: PeriodProps) {
  return <PeriodForm key={`${props.from}:${props.to}`} {...props} />;
}

function PeriodForm({ tab, from, to, facility, timezone, method, group }: PeriodProps) {
  const router = useRouter();
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(addDays(to, -1));
  const [error, setError] = useState("");

  function navigate(first: string, last: string) {
    if (!first || !last || first > last) { setError("Choose a valid date range."); return; }
    const params = new URLSearchParams({ tab, from: first, to: addDays(last, 1) });
    if (facility) params.set("facility", facility);
    if (method) params.set("method", method);
    if (group) params.set("group", group);
    router.push(`/owner/fees?${params.toString()}`);
  }
  function month(offset: number) {
    const today = todayInZone(timezone);
    const [year, monthNumber] = today.split("-").map(Number);
    const first = new Date(Date.UTC(year!, monthNumber! - 1 + offset, 1));
    const next = new Date(Date.UTC(year!, monthNumber! + offset, 1));
    navigate(first.toISOString().slice(0, 10), addDays(next.toISOString().slice(0, 10), -1));
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); navigate(start, end); }

  return <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2" aria-label="Collection period">
    {facility ? <input type="hidden" name="facility" value={facility} /> : null}
    <div><label htmlFor="fees-period-from" className="text-[13px] text-ink-2">From date</label><DateField id="fees-period-from" value={start} onChange={setStart} required /></div>
    <div><label htmlFor="fees-period-through" className="text-[13px] text-ink-2">Through date</label><DateField id="fees-period-through" value={end} onChange={setEnd} required /></div>
    <Button type="submit" variant="secondary">Apply period</Button>
    <Button type="button" variant="secondary" onClick={() => month(0)}>This month</Button>
    <Button type="button" variant="secondary" onClick={() => month(-1)}>Last month</Button>
    {error ? <p role="alert" className="text-[13px] text-ink-2">{error}</p> : null}
  </form>;
}
