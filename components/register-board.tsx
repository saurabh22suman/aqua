"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Clock, X } from "lucide-react";
import type { RosterRow } from "@/lib/actions/coach";
import { useOfflineRegister, type Mark } from "@/lib/hooks/use-offline-register";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { CountChip } from "@/components/ui/CountChip";
import { resolveTerm, type TerminologyState } from "@/lib/terminology/keys";

const DEFAULT_TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };

// C-D1 (2026-09-13 audit) — present / late / absent as three 44px hit
// areas. The domain stores `late` already; the register never offered
// it. `warn`, not `late` — a late arrival is not the absent state.
const TOGGLE_BASE =
  "h-11 w-11 grid place-items-center rounded-ctl border transition-colors duration-150";
const TOGGLE_TONES: Record<Mark, { on: string; label: string }> = {
  present: { on: "bg-good-soft border-good text-good", label: "Present" },
  late: { on: "bg-warn-soft border-warn text-warn", label: "Late" },
  absent: { on: "bg-late-soft border-late text-late", label: "Absent" },
};
const TOGGLE_ICONS: Record<Mark, typeof Check> = {
  present: Check,
  late: Clock,
  absent: X,
};
const TOGGLE_ORDER: Mark[] = ["present", "late", "absent"];

export function RegisterBoard({
  sessionId,
  rows,
  offlineSyncEnabled,
  terminology = DEFAULT_TERMINOLOGY,
}: {
  sessionId: string;
  rows: RosterRow[];
  offlineSyncEnabled: boolean;
  // Closed-key vocab resolved by the parent server page (L3 audit).
  // Optional so existing callers/tests render the generic terms; the
  // page passes the tenant-resolved state.
  terminology?: TerminologyState;
}) {
  const initialStatuses = Object.fromEntries(
    rows.filter((r) => r.status).map((r) => [r.memberId, r.status as Mark]),
  );
  const {
    marks,
    mark,
    markedCount,
    pending,
    online,
    savedAtLabel,
    hasActiveFailure,
    saving,
    retrySync,
  } = useOfflineRegister(sessionId, rows, initialStatuses, offlineSyncEnabled);

  // C-D1 (2026-09-13 audit) — bulk marking for the common case where
  // nearly everyone is present. Only unmarked rows are touched, so it
  // never overwrites a mark the coach already made by hand. The marks
  // are written sequentially: with the offline queue off, each tap is
  // its own server action, and firing a dozen concurrently in dev
  // dropped responses; sequential writes keep the count honest and let
  // the button show progress.
  const unmarked = rows.filter((r) => !marks[r.memberId]);
  const canMark = offlineSyncEnabled || online;
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  async function markAllPresent() {
    if (bulk) return;
    const targets = [...unmarked];
    setBulk({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      await mark(targets[i]!.memberId, "present");
      setBulk({ done: i + 1, total: targets.length });
    }
    setBulk(null);
  }

  return (
    <div>
      {/* Kill switch off (issue #4 postmortem, docs/architecture.md
          §12.2): show the instant connectivity drops, not only after a
          failed tap — a coach must never believe a mark saved when it
          didn't. */}
      {!offlineSyncEnabled && !online ? (
        <div
          className="mb-2 rounded-card border border-late bg-late-soft px-4 py-3"
          role="alert"
          data-testid="offline-banner"
        >
          <p className="text-[13px] font-semibold text-late">You&apos;re offline</p>
          <p className="mt-0.5 text-[12px] text-late">
            Marking is unavailable until you reconnect. Nothing you tap right now will be saved.
          </p>
        </div>
      ) : null}

      {/* The lane strip: a coloured surface, not a bare progress bar —
          this is the same signature element the coach today-list and (once
          built) the owner/parent screens reuse. See DESIGN.md §"the lane
          strip". */}
      <div className="sticky top-0 z-10 -mx-5 px-5 pt-3 pb-3 bg-deck/95 backdrop-blur-sm">
        {/* Sync-failure banner (online + hasActiveFailure): the mark
            that didn't land is the single most urgent operational
            signal on this screen. Distinct colour, distinct copy,
            tappable to retry. Priority 1: a failure that the coach
            can act on outranks a "saved locally" message that they
            can't. DESIGN.md §1.1: `late` = error / overdue state, the
            correct token here. */}
        {online && hasActiveFailure ? (
          <button
            type="button"
            onClick={() => void retrySync()}
            data-testid="sync-failure-banner"
            className="mb-2 block w-full rounded-card border border-late bg-late-soft px-4 py-3 text-left"
          >
            <p className="text-[13px] font-semibold text-late">
              Couldn&apos;t sync {pending === 1 ? "1 mark" : `${pending} marks`}.
            </p>
            <p className="mt-0.5 text-[12px] text-late">Tap to retry.</p>
          </button>
        ) : null}

        {/* Offline + pending banner: the queue has durable writes
            that haven't gone through. The lane strip's "offline —
            saved on device" line tells the coach what's true; this
            banner is the count. Priority 2: only shown when offline
            AND pending > 0 (an online + pending state is "syncing
            N…", already conveyed by the lane strip). DESIGN.md §1.1:
            `warn` = needs attention, the correct token for "your
            data is fine, the network isn't". */}
        {!online && pending > 0 ? (
          <div
            data-testid="pending-sync-banner"
            className="mb-2 rounded-card border border-warn bg-warn-soft px-4 py-3"
          >
            <p className="text-[13px] font-semibold text-warn flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-warn motion-reduce:animate-none"
              />
              {pending === 1 ? "1 mark" : `${pending} marks`} saved locally.
            </p>
            <p className="mt-0.5 text-[12px] text-warn">
              Will sync when you&apos;re online.
            </p>
          </div>
        ) : null}

        <div className="rounded-card bg-water-soft px-4 py-3">
          <div className="flex items-baseline justify-between">
            {rows.length === 0 ? (
              <p className="text-[13px] text-ink-2">No one enrolled</p>
            ) : (
              <p className="flex items-center gap-2 text-[13px] text-ink-2">
                <span className="font-display font-semibold text-[15px] text-water">
                  {markedCount}
                </span>{" "}
                of {rows.length} marked
                <CountChip count={markedCount} label="marked" />
                {unmarked.length > 0 ? (
                  <CountChip count={unmarked.length} label="left" tone="warn" />
                ) : null}
              </p>
            )}
            <p
              className="text-[11px] text-ink-3"
              data-testid="sync-state"
              // Copy-independent state for the offline e2e harness (and
              // any future probe). F31 renamed the visible text and
              // broke a `/^synced /` grep in scripts/lib/offline-page.ts
              // even though sync was working; the attribute is the
              // stable contract now.
              data-sync-state={
                offlineSyncEnabled
                  ? saving > 0
                    ? "saving"
                    : !online
                      ? "offline"
                      : pending > 0
                        ? "syncing"
                        : savedAtLabel
                          ? "synced"
                          : "idle"
                  : !online
                    ? "unsavable"
                    : savedAtLabel
                      ? "synced"
                      : "idle"
              }
            >
              {offlineSyncEnabled ? (
                // "saving" outranks everything else: it means a write
                // hasn't even committed to this device yet, which is a
                // truer and more urgent state than "offline" or "syncing"
                // (both of which describe already-durable writes). See
                // docs/architecture.md §12.1.
                saving > 0 ? (
                  "saving…"
                ) : !online ? (
                  "offline — saved on device"
                ) : pending > 0 ? (
                  `syncing ${pending}…`
                ) : savedAtLabel ? (
                  `Saved at ${savedAtLabel}`
                ) : (
                  "Saved on this phone"
                )
              ) : !online ? (
                "offline — can't save"
              ) : savedAtLabel ? (
                `Saved at ${savedAtLabel}`
              ) : (
                "Saved automatically as you mark"
              )}
            </p>
          </div>
          {rows.length > 0 ? (
            <div className="mt-2 h-1.5 rounded-pill bg-paper overflow-hidden">
              <div
                className="h-full rounded-pill bg-water transition-[width] duration-150"
                style={{ width: `${(markedCount / rows.length) * 100}%` }}
              />
            </div>
          ) : null}
          {(unmarked.length > 0 || bulk !== null) && canMark ? (
            <Button
              variant="secondary"
              className="mt-2.5 w-full"
              disabled={bulk !== null}
              onClick={() => void markAllPresent()}
              data-testid="mark-all-present"
            >
              {bulk
                ? `Marking ${bulk.done} of ${bulk.total}…`
                : `Mark all ${unmarked.length} present`}
            </Button>
          ) : null}
        </div>

        {/* Rule 1: a mark that fails to sync must be SEEN, not folded into
            the neutral "syncing" text or left to a console.warn no one
            reads. Distinct colour, distinct copy, stays up until a sync
            actually succeeds. */}
        {hasActiveFailure ? (
          <p className="mt-2 text-[12px] text-late" data-testid="sync-error">
            {offlineSyncEnabled
              ? "Sync failed — retrying. Your marks are saved on this device."
              : "That mark did not save. Try again once you're online."}
          </p>
        ) : null}
      </div>

      <ul className="mt-2 pb-8">
        {rows.length === 0 ? (
          <li className="list-none">
            <EmptyState
              title={`No ${resolveTerm(terminology, "member", "other")} enrolled in this ${resolveTerm(terminology, "batch", 1)}.`}
              body={`Ask the owner to add them from the ${resolveTerm(terminology, "program", 1)} board.`}
              action={{ label: "Back to schedule", href: "/coach/schedule" }}
            />
          </li>
        ) : (
          rows.map((r) => (
          <li
            key={r.memberId}
            data-member-id={r.memberId}
            data-status={marks[r.memberId] ?? ""}
            className="border-b border-line py-2 last:border-0"
          >
            <div className="flex items-center gap-3">
              {/* V-10 — the row's tap-to-assess entry. The name block
                  is a real link so a coach reaches the one-tap band
                  board in one tap from the register; the "Assess ›"
                  hint keeps it discoverable without adding a fourth
                  target to the 132px toggle cluster. */}
              <Link
                href={`/coach/members/${r.memberId}/assess?sessionId=${sessionId}`}
                className="flex-1 min-w-0 min-h-11 flex flex-col justify-center"
                aria-label={`Assess ${r.name}`}
                data-testid={`assess-${r.memberId}`}
              >
                <p className="text-[14px] font-medium truncate flex items-center gap-1.5">
                  {r.name}
                  {r.isTrial ? (
                    <span className="rounded-pill bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn flex-none">
                      Trial
                    </span>
                  ) : null}
                </p>
                <p className="text-[12px] text-ink-3">
                  {r.pct === null ? "—" : `${r.pct}% this month`}
                  <span className="text-water"> · Assess ›</span>
                </p>
              </Link>

              {/* Un-carded on purpose (U1): full-width buttons per row
                  cost 2-3x the vertical space, against the
                  60-second-register target. Each glyph is ~18px but the
                  button is h-11 w-11 (44px) — the hit box meets
                  DESIGN.md §2; don't "tidy" these into labelled
                  buttons. */}
              <div className="flex gap-1.5 flex-none">
                {TOGGLE_ORDER.map((next) => {
                  const Icon = TOGGLE_ICONS[next];
                  const active = marks[r.memberId] === next;
                  return (
                    <button
                      key={next}
                      type="button"
                      onClick={() => mark(r.memberId, next)}
                      aria-label={TOGGLE_TONES[next].label}
                      aria-pressed={active}
                      className={`${TOGGLE_BASE} ${
                        active
                          ? TOGGLE_TONES[next].on
                          : "bg-deck border-line text-ink-3"
                      }`}
                      data-testid={`mark-${next}-${r.memberId}`}
                    >
                      <Icon size={18} strokeWidth={2.4} />
                    </button>
                  );
                })}
              </div>
            </div>
          </li>
          ))
        )}
      </ul>
    </div>
  );
}
