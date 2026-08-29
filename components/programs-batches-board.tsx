"use client";

import { useState } from "react";
import { createBatchAction, createProgramAction } from "@/lib/actions/programs";
import type { Program } from "@/db/schema/programs";
import type { BatchWithProgramName } from "@/lib/services/programs";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ProgramsBatchesBoard({
  initialPrograms,
  initialBatches,
}: {
  initialPrograms: Program[];
  initialBatches: BatchWithProgramName[];
}) {
  const [programs, setPrograms] = useState(initialPrograms);
  const [batches] = useState(initialBatches);
  const [programName, setProgramName] = useState("");
  const [programError, setProgramError] = useState<string | null>(null);
  const [busyProgram, setBusyProgram] = useState(false);

  const [batchProgramId, setBatchProgramId] = useState(programs[0]?.id ?? "");
  const [batchName, setBatchName] = useState("");
  const [capacity, setCapacity] = useState("20");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("07:00");
  const [endTime, setEndTime] = useState("08:00");
  const [batchError, setBatchError] = useState<string | null>(null);
  const [busyBatch, setBusyBatch] = useState(false);

  async function submitProgram() {
    if (!programName.trim()) return;
    setBusyProgram(true);
    setProgramError(null);
    try {
      const res = await createProgramAction({ name: programName.trim() });
      if (!res.ok) {
        setProgramError(res.error);
        return;
      }
      setPrograms((p) => [...p, res.program].sort((a, b) => a.name.localeCompare(b.name)));
      if (!batchProgramId) setBatchProgramId(res.program.id);
      setProgramName("");
    } finally {
      setBusyProgram(false);
    }
  }

  function toggleDay(day: number) {
    setDays((d) => (d.includes(day) ? d.filter((x) => x !== day) : [...d, day].sort()));
  }

  async function submitBatch() {
    if (!batchName.trim() || !batchProgramId || days.length === 0) return;
    setBusyBatch(true);
    setBatchError(null);
    try {
      const res = await createBatchAction({
        programId: batchProgramId,
        name: batchName.trim(),
        capacity: Number(capacity),
        daysOfWeek: days,
        startTime,
        endTime,
      });
      if (!res.ok) {
        setBatchError(res.error);
        return;
      }
      // Simplest correct refresh: batches list needs the joined program
      // name this component doesn't have locally — a full reload is
      // cheap here and avoids duplicating listBatches' join client-side.
      window.location.reload();
    } finally {
      setBusyBatch(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-display text-[15px] font-semibold text-ink-2">Programs</h2>
        <ul className="mt-2 divide-y divide-line" data-testid="programs-list">
          {programs.map((p) => (
            <li key={p.id} className="py-2 text-[14px]">
              {p.name}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={programName}
            onChange={(e) => setProgramName(e.target.value)}
            placeholder="New program name"
            className="flex-1 rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
          />
          <button
            type="button"
            onClick={submitProgram}
            disabled={busyProgram || !programName.trim()}
            className="rounded-ctl bg-mango px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {programError ? <p className="mt-1 text-[12px] text-late">{programError}</p> : null}
      </section>

      <section>
        <h2 className="font-display text-[15px] font-semibold text-ink-2">Batches</h2>
        <ul className="mt-2 divide-y divide-line" data-testid="batches-list">
          {batches.map((b) => (
            <li key={b.id} className="py-2 text-[14px]">
              <span className="font-medium">{b.name}</span>
              <span className="text-ink-3"> — {b.programName}, capacity {b.capacity}, {b.startTime}–{b.endTime}</span>
            </li>
          ))}
        </ul>

        {programs.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-3">Add a program first.</p>
        ) : (
          <div className="mt-3 space-y-2 rounded-card border border-line p-3">
            <select
              value={batchProgramId}
              onChange={(e) => setBatchProgramId(e.target.value)}
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
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
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
            <button
              type="button"
              onClick={submitBatch}
              disabled={busyBatch || !batchName.trim() || days.length === 0}
              className="rounded-ctl bg-mango px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50"
            >
              Add batch
            </button>
            {batchError ? <p className="text-[12px] text-late">{batchError}</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}
