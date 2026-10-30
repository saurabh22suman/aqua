"use client";

import { Button } from "@/components/ui/Button";
import { useEffect, useId, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { updateBatchAction } from "@/lib/actions/programs";
import {
  checkCoachConflictsAction,
  type CoachConflict,
} from "@/lib/actions/coach-conflicts";
import type { BatchWithProgramName, CoachOption } from "@/lib/services/programs";
import type { LocationOption } from "@/lib/services/people";
import type { Program } from "@/db/schema/programs";
import { resolveTerm, type TerminologyState } from "@/lib/terminology/keys";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { TimeField } from "@/components/ui/TimeField";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type BatchEditFormState = {
  programId: string;
  name: string;
  capacity: string;
  days: number[];
  startTime: string;
  endTime: string;
  coachId: string;
  // Wave 2 — the batch's facility.
  locationId: string;
};

export function BatchEditForm({
  batchId,
  initial,
  onDraftChange,
  programs,
  coaches,
  locations,
  error,
  onCancel,
  onSaved,
  onError,
  terminology,
}: {
  batchId: string;
  /**
   * The draft this form edits.
   *
   * When the parent passes `onDraftChange` it OWNS the draft: this component
   * renders that value and reports every edit upward. Without it the form
   * keeps the draft in its own state (a single mounted copy).
   */
  initial: BatchEditFormState;
  onDraftChange?: (draft: BatchEditFormState) => void;
  programs: Program[];
  coaches: CoachOption[];
  locations: LocationOption[];
  error: string | null;
  onCancel: () => void;
  onSaved: (batch: BatchWithProgramName) => void;
  onError: (message: string | null) => void;
  // Closed-key vocab resolved by the parent server page (L3 audit).
  terminology: TerminologyState;
}) {
  // The programs board mounts TWO copies of this form for the same batch:
  // the desktop table (hidden on a phone) and the phone list. A draft kept
  // in one copy's local state is not in the other copy, so changing the
  // viewport showed the other copy's values and the owner's edit vanished
  // from the screen. With `onDraftChange` the parent owns the draft, both
  // copies render the same value, and every edit is reported upward.
  const [localDraft, setLocalDraft] = useState(initial);
  const controlled = Boolean(onDraftChange);
  const form = controlled ? initial : localDraft;

  function update(patch: Partial<BatchEditFormState>) {
    const next = { ...form, ...patch };
    if (!controlled) setLocalDraft(next);
    onDraftChange?.(next);
  }

  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<CoachConflict[]>([]);
  const [startValid, setStartValid] = useState(true);
  const [endValid, setEndValid] = useState(true);

  // The programs board mounts TWO copies of this form for the same
  // batch: the desktop table (hidden on a phone) and the phone list.
  // Ids built from the batch id alone were therefore duplicated in the
  // document, and a <label for> names the FIRST element carrying that
  // id — so the phone copy's visible time controls were labelled by the
  // HIDDEN desktop copy and carried no label association of their own.
  //
  // A per-instance namespace keeps every id this form generates — and
  // the label, help and error references TimeField derives from it —
  // unique per mounted copy. useId is stable across renders and unique
  // per instance; the token is reduced to characters that are safe in
  // an id and in a selector. The data test ids are unchanged.
  const instanceId = useId().replace(/[^A-Za-z0-9_-]/g, "");

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
    })
      .then((res) => {
        if (!cancelled) setConflicts(res.conflicts);
      })
      .catch(() => {
        // Advisory check only — never block or crash the editor.
        if (!cancelled) setConflicts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.coachId, form.days, form.startTime, form.endTime, batchId]);

  function toggleDay(day: number) {
    update({
      days: form.days.includes(day)
        ? form.days.filter((x) => x !== day)
        : [...form.days, day].sort(),
    });
  }

  async function save() {
    if (!form.name.trim() || form.days.length === 0 || !startValid || !endValid) {
      return;
    }
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
        locationId: form.locationId || undefined,
      });
      if (!res.ok) {
        onError(res.error);
        return;
      }
      onSaved(res.batch);
    } catch {
      onError(
        "The change did not reach the server. Your edits are kept — try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-card border border-line p-3">
      <Select
        value={form.programId}
        onChange={(e) => update({ programId: e.target.value })}
        aria-label="Program"
      >
        {programs.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Input
        type="text"
        value={form.name}
        onChange={(e) => update({ name: e.target.value })}
        placeholder="Batch name"
        data-testid={`edit-batch-name-${batchId}`}
      />
      {/* Owner UX audit (2026-10-24): the two time inputs had no
          visible label AND no accessible name. Persistent visible
          labels, in the same shape as the create form. */}
      <label className="block">
        <span className="block text-[12px] text-ink-3 mb-1">Capacity</span>
        <Input
          type="number"
          min={1}
          value={form.capacity}
          onChange={(e) => update({ capacity: e.target.value })}
          aria-label="Capacity"
        />
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TimeField
          id={`batch-edit-start-${batchId}-${instanceId}`}
          label="Start time"
          value={form.startTime}
          onChange={(value) => update({ startTime: value })}
          onValidityChange={setStartValid}
          required
          data-testid={`edit-batch-start-${batchId}`}
        />
        <TimeField
          id={`batch-edit-end-${batchId}-${instanceId}`}
          label="End time"
          value={form.endTime}
          onChange={(value) => update({ endTime: value })}
          onValidityChange={setEndValid}
          required
          data-testid={`edit-batch-end-${batchId}`}
        />
      </div>
      {locations.length > 1 ? (
        <Select
          value={form.locationId}
          onChange={(e) => update({ locationId: e.target.value })}
          aria-label="Location"
          data-testid={`edit-batch-location-${batchId}`}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Select
        value={form.coachId}
        onChange={(e) => update({ coachId: e.target.value })}
        aria-label={resolveTerm(terminology, "coach", 1)}
        data-testid={`edit-batch-coach-${batchId}`}
      >
        <option value="">No {resolveTerm(terminology, "coach", 1)} assigned</option>
        {coaches.map((c) => (
          <option key={c.staffId} value={c.staffId}>
            {c.fullName}
          </option>
        ))}
      </Select>
      <div className="flex gap-1.5">
        {DAY_LABELS.map((label, day) => (
          <button
            key={day}
            type="button"
            onClick={() => toggleDay(day)}
            aria-pressed={form.days.includes(day)}
            className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-ctl border text-[12px] ${
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
        <Button
          variant="primary"
          size="md"
          className="inline-flex items-center justify-center flex-1"
          type="button"
          onClick={save}
          disabled={saving || !form.name.trim() || form.days.length === 0 || !startValid || !endValid}
          data-testid={`save-batch-${batchId}`}>
        Save batch
      </Button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center justify-center rounded-ctl border border-line px-4 py-2 text-[14px] text-ink-3"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
