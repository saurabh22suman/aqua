"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Trash2, X, Check } from "lucide-react";
import {
  createProgramAction,
  deleteBatchAction,
  deleteProgramAction,
  updateProgramAction,
} from "@/lib/actions/programs";
import { BatchEditForm, type BatchEditFormState } from "@/components/batch-edit-form";
import { BatchCreateForm } from "@/components/batch-create-form";
import type { Program } from "@/db/schema/programs";
import type { BatchWithProgramName, CoachOption } from "@/lib/services/programs";

export function ProgramsBatchesBoard({
  initialPrograms,
  initialBatches,
  coaches,
}: {
  initialPrograms: Program[];
  initialBatches: BatchWithProgramName[];
  coaches: CoachOption[];
}) {
  const [programs, setPrograms] = useState(initialPrograms);
  const [batches, setBatches] = useState(initialBatches);
  const [programName, setProgramName] = useState("");
  const [programError, setProgramError] = useState<string | null>(null);
  const [busyProgram, setBusyProgram] = useState(false);
  const [confirmDeleteProgram, setConfirmDeleteProgram] = useState<string | null>(null);
  const [editingProgram, setEditingProgram] = useState<string | null>(null);
  const [editingProgramName, setEditingProgramName] = useState("");

  const [batchError, setBatchError] = useState<string | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState<string | null>(null);
  const [editingBatch, setEditingBatch] = useState<string | null>(null);
  const [editBatchForm, setEditBatchForm] = useState<BatchEditFormState | null>(null);

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
      setProgramName("");
    } finally {
      setBusyProgram(false);
    }
  }

  async function removeProgram(programId: string) {
    setProgramError(null);
    const res = await deleteProgramAction(programId);
    if (!res.ok) {
      setProgramError(res.error);
      setConfirmDeleteProgram(null);
      return;
    }
    setPrograms((p) => p.filter((x) => x.id !== programId));
    setConfirmDeleteProgram(null);
  }

  function startEditProgram(program: Program) {
    setEditingProgram(program.id);
    setEditingProgramName(program.name);
  }

  async function saveProgram(programId: string) {
    if (!editingProgramName.trim()) return;
    setBusyProgram(true);
    setProgramError(null);
    try {
      const res = await updateProgramAction({ programId, name: editingProgramName.trim() });
      if (!res.ok) {
        setProgramError(res.error);
        return;
      }
      setPrograms((p) => p.map((x) => (x.id === programId ? res.program : x)).sort((a, b) => a.name.localeCompare(b.name)));
      setEditingProgram(null);
    } finally {
      setBusyProgram(false);
    }
  }

  async function removeBatch(batchId: string) {
    setBatchError(null);
    const res = await deleteBatchAction(batchId);
    if (!res.ok) {
      setBatchError(res.error);
      setConfirmDeleteBatch(null);
      return;
    }
    setBatches((b) => b.filter((x) => x.id !== batchId));
    setConfirmDeleteBatch(null);
  }

  function startEditBatch(batch: BatchWithProgramName) {
    setEditingBatch(batch.id);
    setEditBatchForm({
      programId: batch.programId,
      name: batch.name,
      capacity: String(batch.capacity),
      days: [...batch.daysOfWeek],
      startTime: batch.startTime.slice(0, 5),
      endTime: batch.endTime.slice(0, 5),
      coachId: batch.coachId ?? "",
    });
  }

  function cancelEditBatch() {
    setEditingBatch(null);
    setEditBatchForm(null);
  }

  function onBatchSaved(saved: BatchWithProgramName) {
    setBatches((b) => b.map((x) => (x.id === saved.id ? saved : x)).sort((a, c) => a.programName.localeCompare(c.programName) || a.name.localeCompare(c.name)));
    setEditingBatch(null);
    setEditBatchForm(null);
  }

  function onBatchCreated(created: BatchWithProgramName) {
    setBatches((b) => [...b, created].sort((a, c) => a.programName.localeCompare(c.programName) || a.name.localeCompare(c.name)));
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-display text-[15px] font-semibold text-ink-2">Programs</h2>
        <ul className="mt-2 divide-y divide-line" data-testid="programs-list">
          {programs.map((p) => (
            <li key={p.id} className="py-2 flex items-center gap-2">
              {editingProgram === p.id ? (
                <input
                  type="text"
                  value={editingProgramName}
                  onChange={(e) => setEditingProgramName(e.target.value)}
                  className="flex-1 rounded-ctl border border-line bg-deck px-2.5 py-1.5 text-[14px]"
                  data-testid={`edit-program-input-${p.id}`}
                />
              ) : (
                <span className="flex-1 text-[14px]">{p.name}</span>
              )}
              {editingProgram === p.id ? (
                <>
                  <button
                    type="button"
                    onClick={() => saveProgram(p.id)}
                    disabled={busyProgram || !editingProgramName.trim()}
                    className="h-8 w-8 grid place-items-center rounded-ctl text-good"
                    aria-label="Save program"
                    data-testid={`save-program-${p.id}`}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingProgram(null)}
                    className="h-8 w-8 grid place-items-center rounded-ctl text-ink-3"
                    aria-label="Cancel"
                  >
                    <X size={16} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => startEditProgram(p)}
                    aria-label={`Edit ${p.name}`}
                    className="h-8 w-8 grid place-items-center rounded-ctl text-ink-3 hover:text-ink-2"
                  >
                    <Pencil size={15} />
                  </button>
                  {confirmDeleteProgram === p.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => removeProgram(p.id)}
                        className="text-[12px] font-medium text-late"
                        data-testid={`confirm-delete-program-${p.id}`}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteProgram(null)}
                        className="text-[12px] text-ink-3"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteProgram(p.id)}
                      aria-label={`Delete ${p.name}`}
                      className="h-8 w-8 grid place-items-center rounded-ctl text-ink-3 hover:text-late"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </>
              )}
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
            className="rounded-ctl bg-[var(--accent)] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50"
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
            <li key={b.id} className="py-2">
              {editingBatch === b.id && editBatchForm ? (
                <BatchEditForm
                  batchId={b.id}
                  initial={editBatchForm}
                  programs={programs}
                  coaches={coaches}
                  error={batchError}
                  onCancel={cancelEditBatch}
                  onSaved={onBatchSaved}
                  onError={setBatchError}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 text-[14px]">
                    <Link
                      href={`/owner/batches/${b.id}`}
                      className="font-medium hover:underline underline-offset-2"
                    >
                      {b.name}
                    </Link>
                    <span className="text-ink-3"> — {b.programName}, capacity {b.capacity}, {b.startTime}–{b.endTime}</span>
                    {b.coachName ? <span className="text-ink-3"> · coach {b.coachName}</span> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => startEditBatch(b)}
                    aria-label={`Edit ${b.name}`}
                    className="h-8 w-8 grid place-items-center rounded-ctl text-ink-3 hover:text-ink-2 flex-none"
                  >
                    <Pencil size={15} />
                  </button>
                  {confirmDeleteBatch === b.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => removeBatch(b.id)}
                        className="text-[12px] font-medium text-late"
                        data-testid={`confirm-delete-batch-${b.id}`}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteBatch(null)}
                        className="text-[12px] text-ink-3"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteBatch(b.id)}
                      aria-label={`Delete ${b.name}`}
                      className="h-8 w-8 grid place-items-center rounded-ctl text-ink-3 hover:text-late flex-none"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {batchError ? <p className="mt-1 text-[12px] text-late">{batchError}</p> : null}

        {programs.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-3">Add a program first.</p>
        ) : (
          <BatchCreateForm programs={programs} coaches={coaches} onCreated={onBatchCreated} />
        )}
      </section>
    </div>
  );
}