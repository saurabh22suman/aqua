"use client";

import { useState } from "react";
import { DateField } from "@/components/ui/DateField";
import { Field } from "@/components/ui/Field";

export function OwnerFormDate({ name, label, initialDate }: { name: string; label: string; initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  return <>
    <input type="hidden" name={name} value={date} />
    <Field id={`owner-form-${name}`} label={label} required>
      {field => <DateField {...field} value={date} onChange={setDate} />}
    </Field>
  </>;
}
