"use client";

import { Button } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { createBatchAction } from "@/lib/actions/programs";
import {
  checkCoachConflictsAction,
  type CoachConflict,
} from "@/lib/actions/coach-conflicts";
import type { BatchWithProgramName, CoachOption } from "@/lib/services/programs";
import type { LocationOption } from "@/lib/services/people";
import type { Program } from "@/db/schema/programs";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function BatchCreateForm({
  programs,
  coaches,
  locations,
  onCreated,
  terminology,
}: {
  programs: Program[];
  coaches: CoachOption[];
  // Wave 2 — the facility the batch runs at. The service falls back to
  // the primary location if this is empty, but the form always sends a
  // selection when the tenant has any location.
  locations: LocationOption[];
  onCreated: (batch: BatchWithProgramName) => void;
  // Closed-key vocab resolved by the parent server page (L3 audit).
  // The "No {coach} assigned" option label is the only vocab word
  // in this form; routed through here so a gym / multi-sport /
  // dance tenant that renames `coach` to trainer / trainer /
  // instructor does not leave the picker label drifted.
  terminology: TerminologyState;
}) {
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("20");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("07:00");
  const [endTime, setEndTime] = useState("08:00");
  const [coachId, setCoachId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<CoachConflict[]>([]);

  function toggleDay(day: number) {
    setDays((d) => (d.includes(day) ? d.filter((x) => x !== day) : [...d, day].sort()));
  }

  // R.2 — same shape as BatchEditForm's conflict check; creation
  // had been missing this warning entirely (F3 audit response).
  useEffect(() => {
    if (!coachId || days.length === 0 || endTime <= startTime) {
      setConflicts([]);
      return;
    }
    let cancelled = false;
    checkCoachConflictsAction({
      coachId,
      daysOfWeek: days,
      startTime,
      endTime,
    })
      .then((res) => {
        if (!cancelled) setConflicts(res.conflicts);
      })
      .catch(() => {
        // The conflict check is advisory; a failed check must not
        // block or crash creation.
        if (!cancelled) setConflicts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [coachId, days, startTime, endTime]);

  async function submit() {
    if (!name.trim() || !programId || days.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createBatchAction({
        programId,
        name: name.trim(),
        capacity: Number(capacity),
        daysOfWeek: days,
        startTime,
        endTime,
        coachId: coachId || undefined,
        locationId: locationId || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated(res.batch);
      setName("");
      setConflicts([]);
    } catch {
      setError(
        "The batch could not be created. Your entries are kept — try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-card border border-line p-3">
      <Select
        value={programId}
        onChange={(e) => setProgramId(e.target.value)}
        aria-label="Program"
      >
        {programs.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      {locations.length > 1 ? (
        <Select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          aria-label="Location"
          data-testid="batch-location-picker"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      ) : null}
      <label className="block">
        {/* The tenant's own word for a batch (L3: never hardcode the
            vocabulary). */}
        <span className="block text-[12px] text-ink-3 mb-1">
          {titleCase(resolveTerm(terminology, "batch", 1))} name
        </span>
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Batch name"
        />
      </label>
      {/* Owner UX audit (2026-10-24): the two time inputs had no
          visible label AND no accessible name, so a time field read as
          "07:00" with nothing to say what it was. Persistent visible
          labels, and the tenant's own word for the coach. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="block text-[12px] text-ink-3 mb-1">Capacity</span>
          <Input
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            aria-label="Capacity"
          />
        </label>
        <label className="block">
          <span className="block text-[12px] text-ink-3 mb-1">Start time</span>
          <Input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="min-w-0"
            aria-label="Start time"
          />
        </label>
        <label className="block">
          <span className="block text-[12px] text-ink-3 mb-1">End time</span>
          <Input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="min-w-0"
            aria-label="End time"
          />
        </label>
      </div>
      <label className="block">
        <span className="block text-[12px] text-ink-3 mb-1">
          {resolveTerm(terminology, "coach", 1)}
        </span>
        <Select
          value={coachId}
          onChange={(e) => setCoachId(e.target.value)}
          aria-label={resolveTerm(terminology, "coach", 1)}
          data-testid="batch-coach-picker"
        >
        <option value="">No {resolveTerm(terminology, "coach", 1)} assigned</option>
          {coaches.map((c) => (
            <option key={c.staffId} value={c.staffId}>
              {c.fullName}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex gap-1.5">
        {DAY_LABELS.map((label, day) => (
          <button
            key={day}
            type="button"
            onClick={() => toggleDay(day)}
            aria-pressed={days.includes(day)}
            className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-ctl border text-[12px] ${
              days.includes(day) ? "bg-water-soft border-water text-water" : "bg-deck border-line text-ink-3"
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
          data-testid="coach-conflict-create"
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
      <Button
          variant="primary"
          size="md"
          className="inline-flex items-center justify-center"
        type="button"
        onClick={submit}
        disabled={busy || !name.trim() || days.length === 0}>
        Add batch
      </Button>
    </div>
  );
}
