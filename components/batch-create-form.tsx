"use client";

import { useState } from "react";
import { createBatchAction } from "@/lib/actions/programs";
import type { BatchWithProgramName, CoachOption } from "@/lib/services/programs";
import type { Program } from "@/db/schema/programs";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function BatchCreateForm({
  programs,
  coaches,
  onCreated,
}: {
  programs: Program[];
  coaches: CoachOption[];
  onCreated: (batch: BatchWithProgramName) => void;
}) {
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("20");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("07:00");
  const [endTime, setEndTime] = useState("08:00");
  const [coachId, setCoachId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleDay(day: number) {
    setDays((d) => (d.includes(day) ? d.filter((x) => x !== day) : [...d, day].sort()));
  }

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
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated(res.batch);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-card border border-line p-3">
      <select
        value={programId}
        onChange={(e) => setProgramId(e.target.value)}
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
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Batch name"
        className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
      />
      <div className="flex gap-2">
        <input
          type="number"
          min={1}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          className="w-24 rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
          aria-label="Capacity"
        />
        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
        />
        <input
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
        />
      </div>
      <select
        value={coachId}
        onChange={(e) => setCoachId(e.target.value)}
        className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
        data-testid="batch-coach-picker"
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
            aria-pressed={days.includes(day)}
            className={`h-9 flex-1 rounded-ctl border text-[12px] ${
              days.includes(day) ? "bg-water-soft border-water text-water" : "bg-deck border-line text-ink-3"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <p className="text-[12px] text-late">{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !name.trim() || days.length === 0}
        className="rounded-ctl bg-[var(--accent)] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50"
      >
        Add batch
      </button>
    </div>
  );
}