"use client";

import { useRef } from "react";
import { DateField } from "@/components/ui/DateField";

export function ScheduleDatePicker({ date, view, locationId }: {
  date: string;
  view: "day" | "week" | "month" | "agenda";
  locationId?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);

  function selectDate(value: string) {
    if (!value || !dateInput.current) return;
    dateInput.current.value = value;
    form.current?.requestSubmit();
  }

  return (
    <form ref={form} action="/owner/schedule" method="get" className="w-full max-w-64">
      <input type="hidden" name="view" value={view} />
      <input ref={dateInput} type="hidden" name="date" defaultValue={date} />
      {locationId ? <input type="hidden" name="location" value={locationId} /> : null}
      <DateField value={date} onChange={selectDate} aria-label="Schedule date" required />
    </form>
  );
}
