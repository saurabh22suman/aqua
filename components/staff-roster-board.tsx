"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  createShiftAction,
  deleteShiftAction,
  publishRosterAction,
} from "@/lib/actions/shifts";
import { ShiftTemplateEditor } from "@/components/shift-template-editor";
import { AddShiftForm, type ShiftDraftInput } from "@/components/roster/add-shift-form";
import { RosterPublishPanel } from "@/components/roster/roster-publish-panel";
import type { RosterShiftRow, ShiftTemplateRow } from "@/lib/services/shifts";
import type { StaffRow } from "@/lib/services/staff";
import {
  addDays,
  formatDateIST,
  formatTimeIST,
  formatWeekdayDateIST,
} from "@/lib/time/tz";

// V-23 — the weekly roster builder's interactive half: publish, add a
// shift, delete a shift, and manage the shift templates the builder
// starts from. The week frame and day sections are server-rendered by
// /owner/staff/roster; this island owns the mutations only.
//
// P1 (2026-10-13 owner-UI review) — the add-shift form's location and
// the publication scope are separate state; the scope is stated before
// submission and results name the week, scope and count.

const STATUS_LABEL: Record<string, string> = {
  rostered: "Rostered",
  worked: "Worked",
  absent: "Absent",
  leave: "Leave",
};

export function StaffRosterBoard({
  weekStart,
  shifts,
  templates,
  staff,
  locations,
  weekLocationId,
}: {
  weekStart: string;
  shifts: RosterShiftRow[];
  templates: ShiftTemplateRow[];
  staff: StaffRow[];
  locations: Array<{ id: string; name: string }>;
  // The board's own location filter (null = all locations). This is
  // the publication scope the owner sees and submits.
  weekLocationId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      try {
        const result = await fn();
        setMessage(result.ok ? null : (result.error ?? "Something went wrong."));
        if (result.ok) router.refresh();
      } catch {
        setMessage(
          "The request did not complete. Refresh the board before retrying — it may already have been applied.",
        );
      }
    });
  }

  function publish(targetId: string | null) {
    startTransition(async () => {
      const targetName =
        locations.find((location) => location.id === targetId)?.name ??
        "all locations";
      try {
        const result = await publishRosterAction({
          weekStart,
          ...(targetId ? { locationId: targetId } : {}),
        });
        setMessage(
          result.ok
            ? result.count === 0
              ? `Nothing to publish for the week of ${formatDateIST(weekStart)} at ${targetName} — every shift there is already published.`
              : `Published ${result.count} shift${result.count === 1 ? "" : "s"} for the week of ${formatDateIST(weekStart)} at ${targetName}.`
            : result.error,
        );
        if (result.ok) router.refresh();
      } catch {
        setMessage(
          "The publish request did not complete. Refresh the board before retrying — some shifts may already be published.",
        );
      }
    });
  }

  function addShift(input: ShiftDraftInput) {
    run(() => createShiftAction(input));
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDay = new Map<string, RosterShiftRow[]>();
  for (const shift of shifts) {
    const list = byDay.get(shift.shiftDate) ?? [];
    list.push(shift);
    byDay.set(shift.shiftDate, list);
  }

  return (
    <div className="mt-4">
      <RosterPublishPanel
        weekStart={weekStart}
        locations={locations}
        weekLocationId={weekLocationId}
        pending={pending}
        onPublish={publish}
      />

      {message ? (
        <p role="alert" className="mt-2 text-[13px] text-ink-2">
          {message}
        </p>
      ) : null}

      <AddShiftForm
        weekStart={weekStart}
        templates={templates}
        staff={staff}
        locations={locations}
        initialLocationId={weekLocationId ?? locations[0]?.id ?? ""}
        pending={pending}
        onAdd={addShift}
      />

      <div className="mt-5 space-y-4">
        {days.map((day) => {
          const rows = byDay.get(day) ?? [];
          return (
            <section key={day}>
              <h2 className="text-[13px] font-semibold text-ink-2">
                {formatWeekdayDateIST(`${day}T12:00:00Z`)}
              </h2>
              {rows.length === 0 ? (
                <p className="mt-1 text-[12.5px] text-ink-3">No shifts.</p>
              ) : (
                <ul className="mt-1.5">
                  {rows.map((shift) => (
                    <li
                      key={shift.id}
                      className="mb-2 flex items-center gap-3 rounded-ctl border border-line bg-paper px-3.5 py-3 last:mb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">
                          {shift.staffName}
                        </p>
                        <p className="mt-0.5 text-[12px] text-ink-3">
                          {formatTimeIST(shift.startAt)} –{" "}
                          {formatTimeIST(shift.endAt)} ·{" "}
                          {STATUS_LABEL[shift.status] ?? shift.status} ·{" "}
                          {shift.publishedAt ? "Published" : "Draft"}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Delete shift for ${shift.staffName}`}
                        onClick={() => run(() => deleteShiftAction(shift.id))}
                        className="grid h-11 w-11 flex-none place-items-center rounded-ctl text-ink-3 hover:bg-deck disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <ShiftTemplateEditor
        templates={templates}
        locationId={weekLocationId ?? locations[0]?.id ?? ""}
      />
    </div>
  );
}
