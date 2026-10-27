"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ShiftTemplateRow } from "@/lib/services/shifts";
import type { StaffRow } from "@/lib/services/staff";

// The roster's add-shift form, split out of StaffRosterBoard to keep
// the board module within the line budget. The form owns only the
// shift draft; the publication scope is separate state in the board
// (owner-UI review P1, 2026-10-13).

export type ShiftDraftInput = {
  staffId: string;
  locationId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  templateId?: string;
};

export function AddShiftForm({
  weekStart,
  templates,
  staff,
  locations,
  initialLocationId,
  pending,
  onAdd,
}: {
  weekStart: string;
  templates: ShiftTemplateRow[];
  staff: StaffRow[];
  locations: Array<{ id: string; name: string }>;
  initialLocationId: string;
  pending: boolean;
  onAdd: (input: ShiftDraftInput) => void;
}) {
  const [staffId, setStaffId] = useState<string>(staff[0]?.id ?? "");
  const [shiftDate, setShiftDate] = useState(weekStart);
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("10:00");
  const [templateId, setTemplateId] = useState("");
  const [locationId, setLocationId] = useState(initialLocationId);

  useEffect(() => {
    // A new week is a new draft context; never keep yesterday's date
    // in the add-shift form.
    setShiftDate(weekStart);
  }, [weekStart]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (template) {
      setStartTime(template.startTime.slice(0, 5));
      setEndTime(template.endTime.slice(0, 5));
      if (locations.some((l) => l.id === template.locationId)) {
        setLocationId(template.locationId);
      }
    }
  }

  if (staff.length === 0 || locations.length === 0) {
    return (
      <section className="mt-5 rounded-card border border-line bg-paper p-4">
        <h2 className="font-display text-[15px] font-semibold">Add a shift</h2>
        <p className="mt-2 text-[13px] text-ink-3">
          Add a staff member and a location before building the roster.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-5 rounded-card border border-line bg-paper p-4">
      <h2 className="font-display text-[15px] font-semibold">Add a shift</h2>
      <div className="mt-3 grid gap-3">
        <div>
          <Field id="add-shift-staff" label="Staff">
            {(field) => (
              <Select
                {...field}
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              >
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} · {s.staffType}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0">
            <span className="mb-1 block text-[11px] text-ink-3">Date</span>
            <DateField value={shiftDate} onChange={setShiftDate} />
          </label>
          <div className="min-w-0">
            <Field id="add-shift-template" label="Template (optional)">
              {(field) => (
                <Select
                  {...field}
                  value={templateId}
                  onChange={(e) => applyTemplate(e.target.value)}
                >
                  <option value="">Custom times</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <Field id="add-shift-start" label="Start">
              {(field) => (
                <Input
                  {...field}
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="min-w-0">
            <Field id="add-shift-end" label="End">
              {(field) => (
                <Input
                  {...field}
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
        {locations.length > 1 ? (
          <div>
            <Field id="add-shift-location" label="Location of this shift">
              {(field) => (
                <Select
                  {...field}
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        ) : null}
        <Button
          variant="primary"
          size="md"
          disabled={pending || !staffId || !locationId}
          onClick={() =>
            onAdd({
              staffId,
              locationId,
              shiftDate,
              startTime,
              endTime,
              ...(templateId ? { templateId } : {}),
            })
          }
        >
          <Plus size={16} /> Add shift
        </Button>
      </div>
    </section>
  );
}
