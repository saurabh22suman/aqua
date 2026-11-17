"use client";

import { Button } from "@/components/ui/Button";
import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { Pencil, Trash2, X, Check } from "lucide-react";
import { Tap } from "@/components/ui/Tap";
import {
  createProgramAction,
  deleteBatchAction,
  deleteProgramAction,
  updateProgramAction,
} from "@/lib/actions/programs";
import type { BatchEditFormState } from "@/components/batch-edit-form";
import type { Program } from "@/db/schema/programs";
import type { BatchWithProgramName, CoachOption } from "@/lib/services/programs";
import type { LocationOption } from "@/lib/services/people";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";
import { formatWallTime12h } from "@/lib/time/tz";
import { Input } from "@/components/ui/Input";
import { SectionHeading } from "@/components/ui/PageHeader";
import { OwnerDesignHeading } from "@/components/owner-approved/owner-design-heading";

// Match ownerFacilityHref for this fixed route without importing the server-side
// facility resolver (and its validation dependency) into the catalogue bundle.
function batchHref(batchId: string, facilityId?: string): string {
  return `/owner/batches/${batchId}?facility=${encodeURIComponent(facilityId ?? "all")}`;
}

function EditorLoading() {
  return <p role="status" className="py-3 text-[13px] text-ink-2">Loading editor…</p>;
}

const BatchEditForm = dynamic(() => import("@/components/batch-edit-form").then((mod) => mod.BatchEditForm), { loading: EditorLoading });
const BatchCreateForm = dynamic(() => import("@/components/batch-create-form").then((mod) => mod.BatchCreateForm), { loading: EditorLoading });

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
    .map((day) => DAY_LABELS[day] ?? "Day not recognised")
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
  selectedFacilityId,
  canManage,
  canManageBatches = canManage,
  scopeLabel = "All available clubs",
  toolbar,
}: {
  initialPrograms: Program[];
  initialBatches: BatchWithProgramName[];
  coaches: CoachOption[];
  // Wave 2 — facilities for the batch create/edit pickers.
  locations: LocationOption[];
  // Closed-key vocab resolved by the parent server page (L3 audit).
  terminology: TerminologyState;
  selectedFacilityId?: string;
  canManage: boolean;
  canManageBatches?: boolean;
  scopeLabel?: string;
  toolbar?: ReactNode;
}) {
  const [programs, setPrograms] = useState(initialPrograms);
  const [batches, setBatches] = useState(initialBatches);
  const [programName, setProgramName] = useState("");
  const [programError, setProgramError] = useState<string | null>(null);
  const [busyProgram, setBusyProgram] = useState(false);
  const [confirmDeleteProgram, setConfirmDeleteProgram] = useState<string | null>(null);
  const [editingProgram, setEditingProgram] = useState<string | null>(null);
  const [editingProgramName, setEditingProgramName] = useState("");
  const [showProgramEditor, setShowProgramEditor] = useState(canManage && initialPrograms.length === 0);

  const [batchError, setBatchError] = useState<string | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState<string | null>(null);
  const [editingBatch, setEditingBatch] = useState<string | null>(null);
  const [editBatchForm, setEditBatchForm] = useState<BatchEditFormState | null>(null);
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [newBatchProgramId, setNewBatchProgramId] = useState<string | undefined>();
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [busyBatchDelete, setBusyBatchDelete] = useState(false);
  const [busyBatchCreate, setBusyBatchCreate] = useState(false);

  // The program-create affordance is ONE control: the approved mock's
  // round floating action on a phone and the labelled inline action on a
  // desktop (the shared OwnerCreateAction). It is hidden while any editor
  // on this board is open, so it can never float over a form the owner is
  // filling in — and the empty board's honest first program editor never
  // gets a second create affordance above it.
  const showCreateAction =
    canManage &&
    confirmDeleteProgram === null &&
    confirmDeleteBatch === null &&
    !showProgramEditor &&
    !showBatchForm &&
    editingProgram === null &&
    editingBatch === null;

  // The focus follows the OWNER's explicit intent, never the board's own
  // initial state. The empty board's honest first program editor opens on
  // arrival and must NOT take the focus: an unsolicited phone keyboard is
  // worse than a visible field.
  //
  // These are refs, not state: they carry the INTENT between the click
  // and the effect that acts on it, and they never trigger a render.
  const programNameInputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const focusProgramNameRef = useRef(false);
  const focusCreateActionRef = useRef(false);
  const batchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreBatchFocusRef = useRef(false);
  const editingProgramInputRef = useRef<HTMLInputElement>(null);
  const restoreProgramEditRef = useRef<string | null>(null);

  useEffect(() => {
    if (editingProgram) {
      editingProgramInputRef.current?.focus();
      return;
    }
    if (restoreProgramEditRef.current) {
      const id = restoreProgramEditRef.current;
      boardRef.current?.querySelectorAll<HTMLButtonElement>("[data-program-edit]")
        .forEach((button) => { if (button.dataset.programEdit === id) button.focus(); });
      restoreProgramEditRef.current = null;
    }
  }, [editingProgram]);

  function openBatchEditor(trigger: HTMLButtonElement, programId?: string) {
    if (!canManageBatches || showBatchForm || editingBatch || editingProgram || showProgramEditor || confirmDeleteProgram || confirmDeleteBatch) return;
    setBatchNotice(null);
    setNewBatchProgramId(programId);
    batchTriggerRef.current = trigger;
    setShowBatchForm(true);
  }

  useEffect(() => {
    if (showBatchForm || !restoreBatchFocusRef.current) return;
    restoreBatchFocusRef.current = false;
    const trigger = batchTriggerRef.current;
    if (trigger?.isConnected) trigger.focus();
    else boardRef.current?.querySelector<HTMLButtonElement>('[data-testid="add-batch"]')?.focus();
    batchTriggerRef.current = null;
  }, [showBatchForm]);

  // Opening the editor is the owner's explicit act. The editor stays
  // INLINE (no sheet, no route, no write), but it takes the focus to the
  // real name field and brings that field into the readable band of the
  // viewport — the editor opens above the catalogue while the create
  // action floats at the bottom of a phone.
  function openProgramEditor() {
    focusProgramNameRef.current = true;
    setShowProgramEditor(true);
  }

  // Cancelling returns the focus to the create action the owner came
  // from, so the keyboard does not fall back to the top of the document.
  function cancelProgramEditor() {
    focusCreateActionRef.current = true;
    setShowProgramEditor(false);
    setProgramName("");
  }

  // The program name field takes the focus when the owner OPENED the
  // editor with the create action, and it is centred in the viewport so it
  // clears the sticky header and the bottom navigation. No forced smooth
  // scrolling (the motion contract) and no timer — the browser's own
  // scroll, once.
  useEffect(() => {
    if (!showProgramEditor || !focusProgramNameRef.current) return;
    focusProgramNameRef.current = false;
    const input = programNameInputRef.current;
    if (!input) return;
    input.focus();
    if (typeof input.scrollIntoView === "function") {
      input.scrollIntoView({ block: "center" });
    }
  }, [showProgramEditor]);

  // The focus goes back to the create action once it is on screen again.
  // The shared create action is one control in this board, found by the
  // shared marker it carries — the shared component itself is not changed.
  useEffect(() => {
    if (!showCreateAction || !focusCreateActionRef.current) return;
    const action = boardRef.current?.querySelector<HTMLElement>(
      "[data-owner-create-action]",
    );
    if (!action) return;
    focusCreateActionRef.current = false;
    action.focus();
  }, [showCreateAction]);

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
    } catch {
      setProgramError("We could not confirm whether the program was added. Check the program list before retrying.");
    } finally {
      setBusyProgram(false);
    }
  }

  async function removeProgram(programId: string) {
    setProgramError(null);
    setBusyProgram(true);
    try {
      const res = await deleteProgramAction(programId);
      if (!res.ok) { setProgramError(res.error); return; }
      setPrograms((p) => p.filter((x) => x.id !== programId));
      setConfirmDeleteProgram(null);
    } catch {
      setProgramError("We could not confirm whether the program was deleted. Check the program list before retrying.");
    } finally {
      setBusyProgram(false);
    }
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
    } catch {
      setProgramError("We could not confirm whether the program was saved. Your edits are kept; check the program before retrying.");
    } finally {
      setBusyProgram(false);
    }
  }

  async function removeBatch(batchId: string) {
    setBatchError(null);
    setBusyBatchDelete(true);
    try {
      const res = await deleteBatchAction(batchId);
      if (!res.ok) { setBatchError(res.error); return; }
      setBatches((b) => b.filter((x) => x.id !== batchId));
      setConfirmDeleteBatch(null);
    } catch {
      setBatchError("We could not confirm whether the batch was deleted. Check the batch list before retrying.");
    } finally {
      setBusyBatchDelete(false);
    }
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
    setBatches((b) => b.map((x) => (x.id === saved.id ? saved : x)).filter(matchesFacility).sort((a, c) => a.programName.localeCompare(c.programName) || a.name.localeCompare(c.name)));
    if (!matchesFacility(saved)) setBatchNotice(`Batch saved at ${saved.locationName ?? "another facility"}. Switch facility to see it.`);
    setEditingBatch(null);
    setEditBatchForm(null);
  }

  function onBatchCreated(created: BatchWithProgramName) {
    if (matchesFacility(created)) setBatches((b) => [...b, created].sort((a, c) => a.programName.localeCompare(c.programName) || a.name.localeCompare(c.name)));
    else setBatchNotice(`Batch created at ${created.locationName ?? "another facility"}. Switch facility to see it.`);
    setShowBatchForm(false);
  }

  function matchesFacility(batch: BatchWithProgramName) {
    return !selectedFacilityId || batch.locationId === selectedFacilityId;
  }

  return (
    <div ref={boardRef} className="space-y-5">
      <OwnerDesignHeading title="Programs & batches" purpose={`${programs.length === 1 ? "1 program" : `${programs.length} programs`} · ${batches.length === 1 ? "1 batch" : `${batches.length} batches`}`} action={showCreateAction ? (
          <Button
            variant="primary"
            size="sm"
            onClick={openProgramEditor}
            data-testid="add-program"
            data-owner-create-action
          ><OwnerIcon name="plus" size={16} />Add {resolveTerm(terminology, "program", 1)}</Button>
        ) : null} />
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[12px] text-ink-3">Batches at {scopeLabel}</p>{toolbar}</div>
      {batchNotice ? <p role="status" className="text-[13px] text-ink-2">{batchNotice}</p> : null}
      {batchError && !editingBatch ? <p role="alert" className="text-[12.5px] text-ink-2">{batchError}</p> : null}

      {showProgramEditor && canManage ? (
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
              ref={programNameInputRef}
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
              {busyProgram ? "Adding program…" : "Add"}
            </Button>
            {programs.length > 0 ? (
              <Button
                variant="ghost"
                size="md"
                type="button"
                onClick={cancelProgramEditor}
                disabled={busyProgram}
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
      <section className={`rounded-card border border-line bg-paper ${batches.length > 0 && !showBatchForm ? "hidden" : ""}`}>
        <div className="px-5 pt-5">
          <SectionHeading
            title={`Recurring ${resolveTerm(terminology, "batch", "other")}`}
            trailing={
              canManageBatches && programs.length > 0 && !showBatchForm ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={confirmDeleteProgram !== null || confirmDeleteBatch !== null || editingProgram !== null || editingBatch !== null}
                  onClick={(event) => openBatchEditor(event.currentTarget)}
                  data-testid="add-batch"
                >
                  {/* The approved outline plus marks the control that
                      OPENS the form; the form's own submit and dismiss
                      controls carry none. */}
                  <OwnerIcon name="plus" size={16} />
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
                              <Link href={batchHref(b.id, selectedFacilityId)} className="min-h-11 px-1 text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">
                                Open
                              </Link>
                              {canManageBatches ? <BatchRowControls
                                batch={b}
                                disabled={showBatchForm || showProgramEditor || editingProgram !== null || editingBatch !== null || confirmDeleteProgram !== null || (confirmDeleteBatch !== null && confirmDeleteBatch !== b.id)}
                                pending={busyBatchDelete}
                                confirmDeleteBatch={confirmDeleteBatch}
                                onEdit={startEditBatch}
                                onAskDelete={setConfirmDeleteBatch}
                                onDelete={removeBatch}
                              /> : null}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </>
        )}

        {programs.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-ink-3">
            Add a {resolveTerm(terminology, "program", 1)} first.
          </p>
        ) : showBatchForm && canManageBatches ? (
          <div className="mt-4 border-t border-line px-5 py-5">
            <BatchCreateForm
              key={`${newBatchProgramId}:${selectedFacilityId}`}
              programs={programs}
              coaches={coaches}
              locations={locations}
              onCreated={onBatchCreated}
              terminology={terminology}
              initialProgramId={newBatchProgramId}
              initialLocationId={selectedFacilityId}
              onBusyChange={setBusyBatchCreate}
              focusOnMount
            />
              <button
                type="button"
                onClick={() => { restoreBatchFocusRef.current = true; setShowBatchForm(false); }}
                disabled={busyBatchCreate}
                className="mt-3 min-h-11 text-[13px] font-medium text-ink-2 underline underline-offset-2"
              >
                Cancel
              </button>
          </div>
        ) : null}
      </section>
      <section>
        {programs.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-ink-3" data-testid="programs-list">
            No programs yet. Add the first one to create a batch.
          </p>
        ) : (
          <div data-testid="batches-list-mobile"><ul className="mt-3 grid items-start gap-3 lg:grid-cols-2" data-testid="programs-list">
            {programs.map((p) => (
              <li key={p.id} role="group" aria-label={p.name} className="min-w-0 rounded-[18px] border border-line bg-paper p-[18px] lg:p-5">
                <div className="flex min-h-12 flex-wrap items-center gap-2">
                {editingProgram === p.id ? (
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{titleCase(resolveTerm(terminology, "program", 1))} name</span>
                    <Input
                      ref={editingProgramInputRef}
                      type="text"
                      value={editingProgramName}
                      onChange={(e) => setEditingProgramName(e.target.value)}
                      data-testid={`edit-program-input-${p.id}`}
                    />
                  </label>
                ) : (
                  <div className="flex w-full min-w-0 items-center gap-3"><span className="grid h-10 w-10 flex-none place-items-center rounded-ctl bg-[var(--selected-surface)] text-[var(--accent-ink)]"><OwnerIcon name="programs" size={19} /></span><div className="min-w-0"><h3 className="break-words font-display text-[18px] font-semibold">{p.name}</h3><p className="text-[12px] text-ink-3">{batches.filter((batch) => batch.programId === p.id).length} batches</p></div></div>
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
                        {busyProgram ? "Saving program…" : <Check size={16} />}
                      </button>
                    </Tap>
                    <Tap>
                      <button
                        type="button"
                        onClick={() => { restoreProgramEditRef.current = p.id; setEditingProgram(null); }}
                        disabled={busyProgram}
                        className="grid place-items-center rounded-ctl text-ink-3"
                        aria-label="Cancel"
                      >
                        <X size={16} />
                      </button>
                    </Tap>
                  </>
                ) : (
                  <>
                    <div role="group" aria-label={`${p.name} program actions`} className="mt-2 grid w-full grid-cols-2 gap-2">
                    {canManage ? (
                    <Tap>
                      <button
                        type="button"
                        onClick={() => startEditProgram(p)}
                        disabled={showBatchForm || showProgramEditor || editingProgram !== null || editingBatch !== null || confirmDeleteProgram !== null || confirmDeleteBatch !== null}
                        aria-label={`Edit ${p.name}`}
                        data-program-edit={p.id}
                        className="inline-flex items-center justify-center gap-1.5 rounded-ctl border border-line bg-paper px-3 text-[13px] text-ink-2 hover:text-ink"
                      >
                        <Pencil size={15} aria-hidden="true" />Edit program
                      </button>
                    </Tap>) : null}
                    {canManageBatches ? <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl bg-[var(--accent-soft)] px-3 text-[13px] font-medium text-[var(--accent-ink)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]" disabled={showBatchForm || editingBatch !== null || editingProgram !== null || showProgramEditor || confirmDeleteProgram !== null || confirmDeleteBatch !== null} aria-label={`Add ${resolveTerm(terminology, "batch", 1)} to ${p.name}`} onClick={(event) => openBatchEditor(event.currentTarget, p.id)}>
                      <OwnerIcon name="plus" size={16} />Add {resolveTerm(terminology, "batch", 1)}
                    </button> : null}
                    </div>
                    {canManage ? <>
                    {confirmDeleteProgram === p.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => removeProgram(p.id)}
                          disabled={busyProgram}
                          className="min-h-11 px-1 text-[12px] font-medium text-ink-2"
                          data-testid={`confirm-delete-program-${p.id}`}
                        >
                          {busyProgram ? "Deleting program…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteProgram(null)}
                          disabled={busyProgram}
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
                          disabled={showBatchForm || showProgramEditor || editingProgram !== null || editingBatch !== null || confirmDeleteProgram !== null || confirmDeleteBatch !== null}
                          aria-label={`Delete ${p.name}`}
                          className="inline-flex items-center gap-2 rounded-ctl px-2 text-[12px] text-ink-3 hover:text-ink-2"
                        >
                          <Trash2 size={15} />Delete program
                        </button>
                      </Tap>
                    )}
                    </> : null}
                  </>
                )}
                </div>
                {batches.every((batch) => batch.programId !== p.id) ? <p className="mt-2 text-[13px] text-ink-3">No {resolveTerm(terminology, "batch", "other")} at this club.</p> : null}
                <ul className="divide-y divide-line">
                  {batches.filter(b => b.programId === p.id).map(b => <li key={b.id} className="py-2">
                    {editingBatch === b.id && editBatchForm ? <BatchEditForm batchId={b.id} initial={editBatchForm} onDraftChange={updateEditBatchForm} programs={programs} coaches={coaches} locations={locations} error={batchError} onCancel={cancelEditBatch} onSaved={onBatchSaved} onError={setBatchError} terminology={terminology} /> :
                    <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-center">
                      <div role="group" aria-label={`${b.name} details`} className="min-w-0 flex-1 lg:basis-44">
                        <Link href={batchHref(b.id, selectedFacilityId)} className="inline-flex min-h-11 items-center break-words text-[14px] font-medium text-ink">{b.name}</Link>
                        <p className="flex items-center gap-2 text-[12px] text-ink-2"><OwnerIcon name="calendar" size={14} />{daysLabel(b.daysOfWeek)} · {wallRange(b.startTime, b.endTime)}</p>
                        <p className="mt-1 flex items-center gap-2 text-[12px] text-ink-3"><OwnerIcon name="members" size={14} />{b.coachName ? coachLabel(b.coachName, terminology) : "Unassigned"}</p>
                        <p className="mt-1 flex items-center gap-2 text-[12px] text-ink-3"><OwnerIcon name="pin" size={14} />{b.locationName ?? "No club assigned"} · {b.capacity} places</p>
                      </div>
                      <div role="group" aria-label={`${b.name} actions`} className="flex flex-wrap items-center"><Link href={batchHref(b.id, selectedFacilityId)} aria-label={`View batch ${b.name}`} className="inline-flex min-h-11 items-center px-2 text-[13px] font-medium text-[var(--accent-ink)]">View batch</Link>{canManageBatches ? <BatchRowControls batch={b} pending={busyBatchDelete} disabled={showBatchForm || showProgramEditor || editingProgram !== null || editingBatch !== null || confirmDeleteProgram !== null || (confirmDeleteBatch !== null && confirmDeleteBatch !== b.id)} confirmDeleteBatch={confirmDeleteBatch} onEdit={startEditBatch} onAskDelete={setConfirmDeleteBatch} onDelete={removeBatch} /> : null}</div>
                    </div>}
                  </li>)}
                </ul>
              </li>
            ))}
          </ul></div>
        )}

      </section>

    </div>
  );
}

function BatchRowControls({
  batch,
  disabled,
  pending,
  confirmDeleteBatch,
  onEdit,
  onAskDelete,
  onDelete,
}: {
  batch: BatchWithProgramName;
  disabled: boolean;
  pending: boolean;
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
          disabled={pending}
          className="min-h-11 px-1 text-[12px] font-medium text-ink-2"
          data-testid={`confirm-delete-batch-${batch.id}`}
        >
          {pending ? "Deleting batch…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => onAskDelete(null)}
          disabled={pending}
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
          disabled={disabled}
          aria-label={`Edit ${batch.name}`}
          className="inline-flex items-center justify-center gap-1 rounded-ctl px-2 text-[13px] text-ink-2 hover:text-ink"
        >
          <Pencil size={15} aria-hidden="true" />Edit batch
        </button>
      </Tap>
      <Tap>
        <button
          type="button"
          onClick={() => onAskDelete(batch.id)}
          disabled={disabled}
          aria-label={`Delete ${batch.name}`}
          className="grid place-items-center rounded-ctl text-ink-3 hover:text-ink-2"
        >
          <Trash2 size={15} />
        </button>
      </Tap>
    </>
  );
}
