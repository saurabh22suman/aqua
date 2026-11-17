"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listBatchesAction } from "@/lib/actions/programs";
import { enrolMemberAction, listMemberEnrolmentsAction } from "@/lib/actions/enrolment";
import { addToWaitlistAction } from "@/lib/actions/waitlist";
import { transferMemberToBatchAction } from "@/lib/actions/transfer";
import type { MemberEnrolment } from "@/lib/services/enrolment";
import {
  isFailedSeed,
  seedForMember,
  type MemberEnrolmentSeed,
} from "@/components/member-detail/member-panel-initial-data";
import type { BatchWithProgramName } from "@/lib/services/programs";
import { resolveTerm, type TerminologyState } from "@/lib/terminology/keys";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { enrolmentFacilityLabel } from "@/components/member-detail/enrolment-facility-label";

// B3 — a member created through reception's add-member form, or
// produced by converting an enquiry with no prior trial booking,
// previously had no visible way to reach a batch: enrolMember()
// existed but had exactly one reachable caller (bookTrial). This is
// the always-visible follow-up step, on the member detail page, that
// closes that gap for both paths.
//
// C2 — the two data fetches below used to have no error handling: a
// transient failure (confirmed live during QA — a dev-mode stale
// server-action artifact, but any transient failure has the same
// shape) left this section silently blank, indistinguishable from "no
// batches exist yet". Rule 1: fail loudly. `loadError` below is shown
// with a Retry action, never swallowed into an empty-looking panel.
//
// C3 — a member enrolled in one batch previously had no way to add a
// second: the panel only rendered the picker in the zero-enrolments
// branch. A swimmer in two batches is normal. The picker is now
// always shown (filtered to batches not already enrolled in), below
// the current-enrolments list when there is one.

export function MemberEnrolmentPanel({
  memberId,
  terminology,
  canEnrol,
  canWaitlist,
  canReadPrograms = true,
  initialData,
  facility,
}: {
  memberId: string;
  // Closed-key vocab resolved by the parent server page (L3 audit).
  // Three empty-state strings ("not enrolled in any batch",
  // "add a program and batch first", "enrolled in every
  // available batch") route through here so a swim / gym /
  // football tenant that customises `batch` or `program` does
  // not drift from what the panel says.
  terminology: TerminologyState;
  // R10 (2026-10-13 role-workflow audit) — independent write gates:
  // enrol/transfer ride members.write; joining the waitlist rides
  // enquiries.write. Readers keep the enrolment list.
  canEnrol: boolean;
  canWaitlist: boolean;
  canReadPrograms?: boolean;
  // Owner overview only: the already-authorized server read. Absent for every
  // other consumer, which keeps its own mount read.
  initialData?: MemberEnrolmentSeed;
  facility?: { homeId: string; eligible: Array<{ id: string; name: string }> };
}) {
  const router = useRouter();
  const seed = seedForMember(initialData, memberId);
  const [enrolments, setEnrolments] = useState<MemberEnrolment[] | null>(
    seed && !isFailedSeed(seed) ? seed.enrolments : null,
  );
  const [batches, setBatches] = useState<BatchWithProgramName[] | null>(
    seed && !isFailedSeed(seed) ? seed.batches : null,
  );
  const [loadError, setLoadError] = useState<string | null>(
    seed && isFailedSeed(seed) ? "Could not load enrolment data." : null,
  );
  // Stale-response guard: a late read for a previous member is ignored.
  const currentMember = useRef(memberId);
  currentMember.current = memberId;
  const loadEpoch = useRef(0);
  const appliedSeed = useRef<typeof seed>(seed);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [enrolSite, setEnrolSite] = useState(facility?.homeId ?? "");
  const [transferSite, setTransferSite] = useState(facility?.homeId ?? "");
  const [actionError, setActionError] = useState<string | null>(null);
  // R.5 — when the refusal is a full batch, offer the waitlist instead
  // of leaving the user at a dead end.
  const [fullBatch, setFullBatch] = useState<{ memberId: string; batchId: string } | null>(null);
  const [waitlistMessage, setWaitlistMessage] = useState<string | null>(null);
  // R.6 — which enrolment row has its transfer picker open, and where
  // to move that member.
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const at = memberId;
    const run = ++loadEpoch.current;
    setLoadError(null);
    setEnrolments(null);
    setBatches(null);
    try {
      const [enrolmentRows, batchRows] = await Promise.all([
        listMemberEnrolmentsAction(at),
        canReadPrograms ? listBatchesAction() : Promise.resolve([]),
      ]);
      if (at !== currentMember.current || run !== loadEpoch.current) return;
      setEnrolments(enrolmentRows);
      setBatches(batchRows);
    } catch (err) {
      if (at !== currentMember.current || run !== loadEpoch.current) return;
      setLoadError(
        err instanceof Error ? err.message : "Could not load enrolment data.",
      );
    }
  }

  useEffect(() => {
    // A usable seed for THIS member is already the authoritative read.
    if (seedForMember(initialData, memberId)) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, initialData]);

  // A fresh server seed for the same member still applies.
  useEffect(() => {
    const current = seedForMember(initialData, memberId);
    if (!current || appliedSeed.current === current) return;
    appliedSeed.current = current;
    // A newer authoritative read: an older pending one must not win.
    loadEpoch.current += 1;
    if (isFailedSeed(current)) {
      setLoadError("Could not load enrolment data.");
      setEnrolments(null);
      setBatches(null);
      return;
    }
    setLoadError(null);
    setEnrolments(current.enrolments);
    setBatches(current.batches);
  }, [initialData, memberId]);

  const enrolledBatchIds = new Set((enrolments ?? []).map((e) => e.batchId));
  const allowedSites = new Set(facility?.eligible.map((site) => site.id));
  const availableBatches = (batches ?? []).filter((b) => !enrolledBatchIds.has(b.id) && (!facility || b.locationId === null || allowedSites.has(b.locationId)));
  const choicesAt = (site: string) => availableBatches.filter((b) => b.locationId === site || b.locationId === null).sort((a, b) => Number(a.locationId === null) - Number(b.locationId === null));
  const enrolChoices = facility ? choicesAt(enrolSite) : availableBatches;
  const transferChoices = facility ? choicesAt(transferSite) : availableBatches;
  const effectiveBatchId = enrolChoices.some((b) => b.id === selectedBatchId)
    ? selectedBatchId
    : (enrolChoices[0]?.id ?? "");

  async function enrol() {
    if (!effectiveBatchId) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await enrolMemberAction({ memberId, batchId: effectiveBatchId });
      if (!result.ok) {
        setActionError(result.error);
        setFullBatch(/full/i.test(result.error) ? { memberId, batchId: effectiveBatchId } : null);
        return;
      }
      const rows = await listMemberEnrolmentsAction(memberId);
      setEnrolments(rows);
      setSelectedBatchId("");
      setFullBatch(null);
      router.refresh();
    } catch {
      setActionError("Could not complete enrolment. Refresh and check the enrolment list before retrying, in case it was saved.");
    } finally {
      setBusy(false);
    }
  }

  async function joinWaitlist() {
    if (!effectiveBatchId || fullBatch?.batchId !== effectiveBatchId || fullBatch.memberId !== memberId || !canWaitlist) return;
    setBusy(true);
    setWaitlistMessage(null);
    try {
      const res = await addToWaitlistAction({
        memberId,
        batchId: effectiveBatchId,
      });
      if (res.kind === "error") {
        setActionError(res.message);
        return;
      }
      setActionError(null);
      setFullBatch(null);
      setWaitlistMessage(
        `Added to the waitlist at position ${res.position}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  // R.6 — move an enrolment to another batch. The service preserves
  // attendance history (keyed to sessions) and refuses a full
  // destination; the subscription half of V-19 waits for C-30.
  async function moveToBatch(fromBatchId: string) {
    if (!transferTarget) return;
    setBusy(true);
    setTransferError(null);
    try {
      const res = await transferMemberToBatchAction({
        memberId,
        fromBatchId,
        toBatchId: transferTarget,
      });
      if (res.kind === "error") {
        setTransferError(res.message);
        return;
      }
      const rows = await listMemberEnrolmentsAction(memberId);
      setEnrolments(rows);
      setTransferFrom(null);
      setTransferTarget("");
      router.refresh();
    } catch {
      setTransferError("Could not complete transfer. Refresh and check the enrolment list before retrying, in case it was saved.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div
        className="mt-4 rounded-card border border-late bg-late-soft p-3.5"
        role="alert"
        data-testid="enrolment-load-error"
      >
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-late">
          Enrolment
        </h2>
        <p className="mt-2 text-[13px] text-late">{loadError}</p>
        <Button
          variant="secondary"
          onClick={load}
          className="mt-2 border-late text-late hover:bg-late-soft"
          data-testid="enrolment-retry"
        >
          Retry
        </Button>
      </div>
    );
  }

  const loading = enrolments === null || batches === null;

  return (
    <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
      <h2 className="font-display text-[16px] font-semibold text-ink">
        Enrolment
      </h2>

      {loading ? (
        <p className="mt-2.5 text-[13px] text-ink-3">Loading…</p>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          {enrolments!.length > 0 ? (
            <ul className="space-y-1.5">
              {enrolments!.map((e) => (
                <li key={e.batchId}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 break-words text-[13.5px]">
                      {e.batchName} — {e.programName}{canReadPrograms ? ` · ${enrolmentFacilityLabel(e.batchId, batches!)}` : null}
                    </span>
                    {canEnrol && availableBatches.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTransferFrom(
                            transferFrom === e.batchId ? null : e.batchId,
                          );
                          setTransferSite(facility?.homeId ?? "");
                          setTransferTarget((facility ? choicesAt(facility.homeId)[0] : availableBatches[0])?.id ?? "");
                          setTransferError(null);
                        }}
                        className="flex-none rounded-ctl border border-line px-3 min-h-[44px] text-[12.5px] text-ink-2"
                      >
                        Transfer
                      </button>
                    ) : null}
                  </div>
                  {canEnrol && transferFrom === e.batchId ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {facility ? <div className="w-full"><Select aria-label="Transfer facility" value={transferSite} onChange={(event) => { const id = event.target.value; setTransferSite(id); setTransferTarget(choicesAt(id)[0]?.id ?? ""); }}>{facility.eligible.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</Select></div> : null}
                      {/* P2 (independent review) — the flex sizing lives
                          on a lane-owned wrapper around the shared
                          primitive (the primitive renders its own
                          `relative block` wrapper). */}
                      <div className="min-w-0 flex-1">
                        <Select
                          value={transferTarget}
                          onChange={(ev) => setTransferTarget(ev.target.value)}
                          data-testid="transfer-target"
                          aria-label="Transfer to"
                        >
                          {transferChoices.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} — {b.programName} · {b.locationId === null ? "Club-wide" : b.locationName ?? "Facility not specified"}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <button
                        type="button"
                        onClick={() => moveToBatch(e.batchId)}
                        disabled={busy || !transferTarget}
                        className="rounded-ctl bg-[var(--accent-strong)] px-3.5 min-h-[44px] text-[13px] font-medium text-white disabled:opacity-50"
                      >
                        {busy ? "Moving…" : "Move"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTransferFrom(null);
                          setTransferError(null);
                        }}
                        className="rounded-ctl px-2 min-h-[44px] text-[12.5px] text-ink-3"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  {transferFrom === e.batchId && transferError ? (
                    <p className="mt-1 text-[12px] text-ink-2">{transferError}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">Not enrolled in any {resolveTerm(terminology, "batch", "other")} yet.</p>
          )}

          {!canEnrol ? null : availableBatches.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {facility ? <div className="w-full"><Select aria-label="Enrolment facility" value={enrolSite} onChange={(event) => { setEnrolSite(event.target.value); setSelectedBatchId(""); setFullBatch(null); setActionError(null); setWaitlistMessage(null); }}>{facility.eligible.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</Select></div> : null}
              {/* P2 (independent review) — the flex sizing lives on a
                  lane-owned wrapper around the shared primitive. */}
              <div className="w-full min-w-0 flex-1">
                <Select
                  value={effectiveBatchId}
                  onChange={(e) => { setSelectedBatchId(e.target.value); setFullBatch(null); setActionError(null); setWaitlistMessage(null); }}
                  aria-label={`Select ${resolveTerm(terminology, "batch", 1)} to enrol in`}
                  className="min-w-0"
                  data-testid="enrolment-batch-select"
                >
                  {enrolChoices.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} — {b.programName} · {b.locationId === null ? "Club-wide" : b.locationName ?? "Facility not specified"}
                    </option>
                  ))}
                </Select>
              </div>
              {enrolChoices.length === 0 ? <p className="w-full text-[13px] text-ink-3">No available batches at this facility.</p> : null}
              <Button
                variant="primary"
                onClick={enrol}
                disabled={busy || !effectiveBatchId}
                data-testid="enrol-member"
              >
                {busy ? "Enrolling…" : "Enrol"}
              </Button>
            </div>
          ) : batches!.length === 0 ? (
            <p className="text-[13px] text-ink-3">
              No {resolveTerm(terminology, "batch", "other")} yet — add a {resolveTerm(terminology, "program", 1)} and {resolveTerm(terminology, "batch", 1)} first.
            </p>
          ) : (
            <p className="text-[13px] text-ink-3">
              Enrolled in every available {resolveTerm(terminology, "batch", 1)}.
            </p>
          )}
          {actionError ? <p className="text-[12px] text-late">{actionError}</p> : null}
          {fullBatch?.batchId === effectiveBatchId && fullBatch.memberId === memberId && canWaitlist ? (
            <button
              type="button"
              onClick={joinWaitlist}
              disabled={busy}
              className="rounded-ctl border border-line bg-deck px-3.5 min-h-[44px] text-[13px] font-medium text-ink-2 disabled:opacity-50"
            >
              {busy ? "Adding…" : "Join waitlist"}
            </button>
          ) : null}
          {waitlistMessage ? (
            <p className="text-[12px] text-ink-2">{waitlistMessage}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
