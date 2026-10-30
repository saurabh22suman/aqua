"use client";

import { Button } from "@/components/ui/Button";
import { useState } from "react";
import Link from "next/link";
import { Pencil, Trash2, X, Check } from "lucide-react";
import { Tap } from "@/components/ui/Tap";
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
import type { LocationOption } from "@/lib/services/people";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";
import { formatWallTime12h } from "@/lib/time/tz";
import { Input } from "@/components/ui/Input";
import { SectionHeading } from "@/components/ui/PageHeader";

// Owner OpenPen (29 October 2026) — catalogue first, one contextual
// editor at a time. The batch list is an aligned desktop table with an
// identity-first mobile card; recurrence, coach and capacity sit on one
// row. Creation opens only when the owner asks for it.
//
// O-D5 (2026-09-13 audit) — the row prefixes the coach term, but real
// (and seed) names can already lead with it ("Coach Aanya Rao"),
// producing "coach Coach Aanya Rao". Skip the prefix when the name
// already carries it.
function coachLabel(name: string, terminology: TerminologyState): string {
  const term = resolveTerm(terminology, "coach", 1);
  const lower = name.toLowerCase();
  return lower === term.toLowerCase() || lower.startsWith(`${term.toLowerCase()} `)
    ? name
    : `${term} ${name}`;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function daysLabel(days: number[]): string {
  if (days.length === 0) return "No days set";
  return [...days]
    .sort((a, b) => a - b)
    .map((day) => DAY_LABELS[day] ?? String(day))
    .join(" · ");
}

function wallRange(start: string, end: string): string {
  return `${formatWallTime12h(start)}–${formatWallTime12h(end)}`;
}

export function ProgramsBatchesBoard({
  initialPrograms,
  initialBatches,
  coaches,
  locations,
  terminology,
}: {
  initialPrograms: Program[];
  initialBatches: BatchWithProgramName[];
  coaches: CoachOption[];
  // Wave 2 — facilities for the batch create/edit pickers.
  locations: LocationOption[];
  // Closed-key vocab resolved by the parent server page (L3 audit).
  terminology: TerminologyState;
}) {
  const [programs, setPrograms] = useState(initialPrograms);
  const [batches, setBatches] = useState(initialBatches);
  const [programName, setProgramName] = useState("");
  const [programError, setProgramError] = useState<string | null>(null);
  const [busyProgram, setBusyProgram] = useState(false);
  const [confirmDeleteProgram, setConfirmDeleteProgram] = useState<string | null>(null);
  const [editingProgram, setEditingProgram] = useState<string | null>(null);
  const [editingProgramName, setEditingProgramName] = useState("");
  const [showProgramEditor, setShowProgramEditor] = useState(initialPrograms.length === 0);

  const [batchError, setBatchError] = useState<string | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState<string | null>(null);
  const [editingBatch, setEditingBatch] = useState<string | null>(null);
  const [editBatchForm, setEditBatchForm] = useState<BatchEditFormState | null>(null);
  const [showBatchForm, setShowBatchForm] = useState(initialBatches.length === 0);

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
      setShowProgramEditor(false);
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
      locationId: batch.locationId ?? "",
    });
  }

  function cancelEditBatch() {
    setEditingBatch(null);
    setEditBatchForm(null);
  }

  // The board mounts the batch editor TWICE for the same batch — the
  // desktop table and the phone list — so the draft lives here, in the
  // parent, and both copies render it. A draft kept in one copy's own state
  // was not in the other copy: changing the viewport showed the other
  // copy's values and the owner's edit vanished from the screen.
  function updateEditBatchForm(draft: BatchEditFormState) {
    setEditBatchForm(draft);
  }

  function onBatchSaved(saved: BatchWithProgramName) {
    setBatches((b) => b.map((x) => (x.id === saved.id ? saved : x)).sort((a, c) => a.programName.localeCompare(c.programName) || a.name.localeCompare(c.name)));
    setEditingBatch(null);
    setEditBatchForm(null);
  }

  function onBatchCreated(created: BatchWithProgramName) {
    setBatches((b) => [...b, created].sort((a, c) => a.programName.localeCompare(c.programName) || a.name.localeCompare(c.name)));
    setShowBatchForm(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-ink-3">
          {programs.length === 1 ? "1 program" : `${programs.length} programs`} · add one before creating a batch.
        </p>
        {!showProgramEditor ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowProgramEditor(true)}
            data-testid="add-program"
          >
            Add program
          </Button>
        ) : null}
      </div>

      {showProgramEditor ? (
        <form
          className="rounded-card border border-line bg-paper px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submitProgram();
          }}
        >
          <label className="block text-[12px] text-ink-3" htmlFor="new-program-name">
            New program
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <Input
              id="new-program-name"
              type="text"
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              placeholder="For example, Learn to swim"
              className="min-w-0 flex-1"
            />
            <Button
              variant="primary"
              size="md"
              type="submit"
              disabled={busyProgram || !programName.trim()}
            >
              {busyProgram ? "Adding…" : "Add"}
            </Button>
            {programs.length > 0 ? (
              <Button
                variant="ghost"
                size="md"
                type="button"
                onClick={() => {
                  setShowProgramEditor(false);
                  setProgramName("");
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
          {programError ? (
            <p role="alert" className="mt-2 text-[12.5px] text-ink-2">
              {programError}
            </p>
          ) : null}
        </form>
      ) : programError ? (
        <p role="alert" className="text-[12.5px] text-ink-2">{programError}</p>
      ) : null}
      <section className="rounded-card border border-line bg-paper">
        <div className="px-5 pt-5">
          <SectionHeading
            title={`Recurring ${resolveTerm(terminology, "batch", "other")}`}
            subtitle="Recurrence, coach and capacity define what the register will ask for."
            trailing={
              programs.length > 0 && !showBatchForm ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowBatchForm(true)}
                  data-testid="add-batch"
                >
                  Add {resolveTerm(terminology, "batch", 1)}
                </Button>
              ) : null
            }
          />
        </div>

        {batches.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-ink-3" data-testid="batches-list">
            No {resolveTerm(terminology, "batch", "other")} yet.
          </p>
        ) : (
          <>
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[680px] border-collapse text-[13px]" data-testid="batches-list">
                <thead>
                  <tr className="border-y border-line text-left text-[11px] uppercase tracking-[0.08em] text-ink-3">
                    <th scope="col" className="px-5 py-2.5 font-medium">{titleCase(resolveTerm(terminology, "batch", 1))} / program</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Days</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Time</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">{titleCase(resolveTerm(terminology, "coach", 1))}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Places</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {batches.map((b) => (
                    <tr key={b.id} data-testid={`batch-row-${b.id}`}>
                      {editingBatch === b.id && editBatchForm ? (
                        <td colSpan={6} className="px-5 py-4">
                          <BatchEditForm
                            batchId={b.id}
                            initial={editBatchForm}
                            onDraftChange={updateEditBatchForm}
                            programs={programs}
                            coaches={coaches}
                            locations={locations}
                            error={batchError}
                            onCancel={cancelEditBatch}
                            onSaved={onBatchSaved}
                            onError={setBatchError}
                            terminology={terminology}
                          />
                        </td>
                      ) : (
                        <>
                          <td className="px-5 py-3">
                            <p className="font-medium text-ink">{b.name}</p>
                            <p className="mt-0.5 text-[12px] text-ink-3">
                              {b.programName}
                              {b.locationName ? ` · ${b.locationName}` : ""}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-ink-2">{daysLabel(b.daysOfWeek)}</td>
                          <td className="px-3 py-3 tabular-nums text-ink-2">{wallRange(b.startTime, b.endTime)}</td>
                          <td className="px-3 py-3 text-ink-2">{b.coachName ? coachLabel(b.coachName, terminology) : "Unassigned"}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-ink-2">{b.capacity}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <Link href={`/owner/batches/${b.id}`} className="min-h-11 px-1 text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">
                                Open
                              </Link>
                              <BatchRowControls
                                batch={b}
                                confirmDeleteBatch={confirmDeleteBatch}
                                onEdit={startEditBatch}
                                onAskDelete={setConfirmDeleteBatch}
                                onDelete={removeBatch}
                              />
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-4 divide-y divide-line md:hidden" data-testid="batches-list-mobile">
              {batches.map((b) => (
                <li key={b.id} className="px-5 py-3">
                  {editingBatch === b.id && editBatchForm ? (
                    <BatchEditForm
                      batchId={b.id}
                      initial={editBatchForm}
                      onDraftChange={updateEditBatchForm}
                      programs={programs}
                      coaches={coaches}
                      locations={locations}
                      error={batchError}
                      onCancel={cancelEditBatch}
                      onSaved={onBatchSaved}
                      onError={setBatchError}
                      terminology={terminology}
                    />
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/owner/batches/${b.id}`} className="block truncate text-[14px] font-medium text-ink">
                            {b.name}
                          </Link>
                          <p className="mt-0.5 text-[12px] text-ink-3">
                            {b.programName}
                            {b.locationName ? ` · ${b.locationName}` : ""}
                          </p>
                        </div>
                        <span className="flex-none text-[12px] tabular-nums text-ink-3">{b.capacity} places</span>
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                        <div><dt className="text-ink-3">Days</dt><dd className="text-ink-2">{daysLabel(b.daysOfWeek)}</dd></div>
                        <div><dt className="text-ink-3">Time</dt><dd className="text-ink-2 tabular-nums">{wallRange(b.startTime, b.endTime)}</dd></div>
                        <div className="col-span-2"><dt className="text-ink-3">{titleCase(resolveTerm(terminology, "coach", 1))}</dt><dd className="text-ink-2">{b.coachName ? coachLabel(b.coachName, terminology) : "Unassigned"}</dd></div>
                      </dl>
                      <div className="mt-2 flex items-center gap-1">
                        <Link href={`/owner/batches/${b.id}`} className="min-h-11 px-1 text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">
                          Open
                        </Link>
                        <BatchRowControls
                          batch={b}
                          confirmDeleteBatch={confirmDeleteBatch}
                          onEdit={startEditBatch}
                          onAskDelete={setConfirmDeleteBatch}
                          onDelete={removeBatch}
                        />
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {batchError ? (
          <p role="alert" className="px-5 py-2 text-[12.5px] text-ink-2">{batchError}</p>
        ) : null}

        {programs.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-ink-3">
            Add a {resolveTerm(terminology, "program", 1)} first.
          </p>
        ) : showBatchForm ? (
          <div className="mt-4 border-t border-line px-5 py-5">
            <BatchCreateForm
              programs={programs}
              coaches={coaches}
              locations={locations}
              onCreated={onBatchCreated}
              terminology={terminology}
            />
            {batches.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowBatchForm(false)}
                className="mt-3 min-h-11 text-[13px] font-medium text-ink-2 underline underline-offset-2"
              >
                Cancel
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="rounded-card border border-line bg-paper">
        <div className="px-5 pt-5">
          <SectionHeading
            title="Programs"
            subtitle="A program groups the batches that share a purpose."
          />
        </div>

        {programs.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-ink-3" data-testid="programs-list">
            No programs yet. Add the first one to create a batch.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line px-5" data-testid="programs-list">
            {programs.map((p) => (
              <li key={p.id} className="flex min-h-12 items-center gap-1 py-1.5">
                {editingProgram === p.id ? (
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{titleCase(resolveTerm(terminology, "program", 1))} name</span>
                    <Input
                      type="text"
                      value={editingProgramName}
                      onChange={(e) => setEditingProgramName(e.target.value)}
                      data-testid={`edit-program-input-${p.id}`}
                    />
                  </label>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[14px]">{p.name}</span>
                )}
                {editingProgram === p.id ? (
                  <>
                    <Tap>
                      <button
                        type="button"
                        onClick={() => saveProgram(p.id)}
                        disabled={busyProgram || !editingProgramName.trim()}
                        className="grid place-items-center rounded-ctl text-ink-2"
                        aria-label="Save program"
                        data-testid={`save-program-${p.id}`}
                      >
                        <Check size={16} />
                      </button>
                    </Tap>
                    <Tap>
                      <button
                        type="button"
                        onClick={() => setEditingProgram(null)}
                        className="grid place-items-center rounded-ctl text-ink-3"
                        aria-label="Cancel"
                      >
                        <X size={16} />
                      </button>
                    </Tap>
                  </>
                ) : (
                  <>
                    <Tap>
                      <button
                        type="button"
                        onClick={() => startEditProgram(p)}
                        aria-label={`Edit ${p.name}`}
                        className="grid place-items-center rounded-ctl text-ink-3 hover:text-ink-2"
                      >
                        <Pencil size={15} />
                      </button>
                    </Tap>
                    {confirmDeleteProgram === p.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => removeProgram(p.id)}
                          className="min-h-11 px-1 text-[12px] font-medium text-ink-2"
                          data-testid={`confirm-delete-program-${p.id}`}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteProgram(null)}
                          className="min-h-11 px-1 text-[12px] text-ink-3"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <Tap>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteProgram(p.id)}
                          aria-label={`Delete ${p.name}`}
                          className="grid place-items-center rounded-ctl text-ink-3 hover:text-ink-2"
                        >
                          <Trash2 size={15} />
                        </button>
                      </Tap>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

      </section>

    </div>
  );
}

function BatchRowControls({
  batch,
  confirmDeleteBatch,
  onEdit,
  onAskDelete,
  onDelete,
}: {
  batch: BatchWithProgramName;
  confirmDeleteBatch: string | null;
  onEdit: (batch: BatchWithProgramName) => void;
  onAskDelete: (id: string | null) => void;
  onDelete: (id: string) => void;
}) {
  if (confirmDeleteBatch === batch.id) {
    return (
      <>
        <button
          type="button"
          onClick={() => onDelete(batch.id)}
          className="min-h-11 px-1 text-[12px] font-medium text-ink-2"
          data-testid={`confirm-delete-batch-${batch.id}`}
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => onAskDelete(null)}
          className="min-h-11 px-1 text-[12px] text-ink-3"
        >
          Cancel
        </button>
      </>
    );
  }
  return (
    <>
      <Tap>
        <button
          type="button"
          onClick={() => onEdit(batch)}
          aria-label={`Edit ${batch.name}`}
          className="grid place-items-center rounded-ctl text-ink-3 hover:text-ink-2"
        >
          <Pencil size={15} />
        </button>
      </Tap>
      <Tap>
        <button
          type="button"
          onClick={() => onAskDelete(batch.id)}
          aria-label={`Delete ${batch.name}`}
          className="grid place-items-center rounded-ctl text-ink-3 hover:text-ink-2"
        >
          <Trash2 size={15} />
        </button>
      </Tap>
    </>
  );
}
