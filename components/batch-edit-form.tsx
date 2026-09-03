"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { updateBatchAction } from "@/lib/actions/programs";
import {
  checkCoachConflictsAction,
  type CoachConflict,
} from "@/lib/actions/coach-conflicts";
import type { BatchWithProgramName, CoachOption } from "@/lib/services/programs";
import type { Program } from "@/db/schema/programs";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type BatchEditFormState = {
  programId: string;
  name: string;
  capacity: string;
  days: number[];
  startTime: string;
  endTime: string;
  coachId: string;
};

export function BatchEditForm({
  batchId,
  initial,
  programs,
  coaches,
  error,
  onCancel,
  onSaved,
  onError,
}: {
  batchId: string;
  initial: BatchEditFormState;
  programs: Program[];
  coaches: CoachOption[];
  error: string | null;
  onCancel: () => void;
  onSaved: (batch: BatchWithProgramName) => void;
  onError: (message: string | null) => void;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<CoachConflict[]>([]);

  // R.2 — when coach / time / days change, ask the server
  // whether the new assignment overlaps anything the same coach
  // is already running. The save proceeds regardless — the
  // warning renders above the save button, never as a blocker,
  // because double-booking can be intentional (e.g. cover for
  // a sick coach) and never should silently lose the user's
  // input. Empty coachId, empty days, or end<=start short-
  // circuits to an empty list.
  useEffect(() => {
    if (!form.coachId || form.days.length === 0 || form.endTime <= form.startTime) {
      setConflicts([]);
      return;
    }
    let cancelled = false;
    checkCoachConflictsAction({
      coachId: form.coachId,
      daysOfWeek: form.days,
      startTime: form.startTime,
      endTime: form.endTime,
      excludeBatchId: batchId,
    }).then((res) => {
      if (!cancelled) setConflicts(res.conflicts);
    });
    return () => {
      cancelled = true;
    };
  }, [form.coachId, form.days, form.startTime, form.endTime, batchId]);

  function toggleDay(day: number) {
    setForm((f) =>
      f
        ? {
            ...f,
            days: f.days.includes(day)
              ? f.days.filter((x) => x !== day)
              : [...f.days, day].sort(),
          }
        : f,
    );
  }

  async function save() {
    if (!form.name.trim() || form.days.length === 0) return;
    setSaving(true);
    onError(null);
    try {
      const res = await updateBatchAction({
        batchId,
        programId: form.programId,
        name: form.name.trim(),
        capacity: Number(form.capacity),
        daysOfWeek: form.days,
        startTime: form.startTime,
        endTime: form.endTime,
        coachId: form.coachId || undefined,
      });
      if (!res.ok) {
        onError(res.error);
        return;
      }
      onSaved(res.batch);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-card border border-line p-3">
      <select
        value={form.programId}
        onChange={(e) => setForm({ ...form, programId: e.target.value })}
        className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
      >
        {programs.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Batch name"
        className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
        data-testid={`edit-batch-name-${batchId}`}
      />
      <div className="flex gap-2">
        <input
          type="number"
          min={1}
          value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          className="w-24 rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
          aria-label="Capacity"
        />
        <input
          type="time"
          value={form.startTime}
          onChange={(e) => setForm({ ...form, startTime: e.target.value })}
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
        />
        <input
          type="time"
          value={form.endTime}
          onChange={(e) => setForm({ ...form, endTime: e.target.value })}
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
        />
      </div>
      <select
        value={form.coachId}
        onChange={(e) => setForm({ ...form, coachId: e.target.value })}
        className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
        data-testid={`edit-batch-coach-${batchId}`}
      >
        <option value="">No coach assigned</option>
        {coaches.map((c) => (
          <option key={c.staffId} value={c.staffId}>
            {c.fullName}
          </option>
        ))}
      </select>
      <div className="flex gap-1.5">
        {DAY_LABELS.map((label, day) => (
          <button
            key={day}
            type="button"
            onClick={() => toggleDay(day)}
            aria-pressed={form.days.includes(day)}
            className={`h-9 flex-1 rounded-ctl border text-[12px] ${
              form.days.includes(day)
                ? "bg-water-soft border-water text-water"
                : "bg-deck border-line text-ink-3"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {conflicts.length > 0 ? (
        <div
          className="mt-1 rounded-ctl bg-warn-soft border border-warn px-3 py-2 flex gap-2"
          role="alert"
          data-testid={`coach-conflict-${batchId}`}
        >
          <AlertTriangle size={14} className="text-warn flex-none mt-0.5" />
          <p className="text-[12px] text-ink-2">
            <span className="font-medium">Coach double-booked.</span>{" "}
            {conflicts.length === 1
              ? `Also running on day ${conflicts[0].daysOverlap.join(", ")}:`
              : `Conflicts with ${conflicts.length} other batches:`}{" "}
            {conflicts.map((c) => c.batchName).join(", ")}.
          </p>
        </div>
      ) : null}
      {error ? <p className="text-[12px] text-late">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !form.name.trim() || form.days.length === 0}
          className="flex-1 rounded-ctl bg-[var(--accent)] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50"
          data-testid={`save-batch-${batchId}`}
        >
          Save batch
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-ctl border border-line px-4 py-2 text-[14px] text-ink-3"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
