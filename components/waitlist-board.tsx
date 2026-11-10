"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListOrdered } from "lucide-react";
import {
  cancelWaitlistAction,
  promoteHeadAction,
} from "@/lib/actions/waitlist";
import type { WaitlistRow } from "@/lib/services/waitlist";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDateIST } from "@/lib/time/tz";
import { SectionHeading } from "@/components/ui/PageHeader";

// R.5 (docs/five-day-work-guide.md) — the batch-side waitlist queue.
// Owner OpenPen (29 October 2026): the ordered queue is evidence beside
// the batch attendance figure; the head carries the one promote action,
// removal stays a quiet secondary link. Known gap carried from the
// service: promotion does not re-check capacity (logged in the work
// guide); the button is manual on purpose until that guard lands.
export function WaitlistBoard({
  batchId,
  initialRows,
  canManage,
}: {
  batchId: string;
  initialRows: WaitlistRow[];
  // R10 (2026-10-13 role-workflow audit) — promoting/removing rides
  // enquiries.write; a reader without it keeps the queue view only.
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ kind: "ok" } | { kind: "error"; message: string }>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res.kind === "error") {
        setError(res.message);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-card border border-line bg-paper p-5"
      data-testid="waitlist-board"
    >
      <SectionHeading
        title={
          <span className="inline-flex items-center gap-2">
            <ListOrdered size={16} className="text-ink-3" aria-hidden="true" />
            Waitlist in order
          </span>
        }
      />

      {initialRows.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No one is waiting"
            body="When this batch is full, staff can add a member to the queue from their profile."
          />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {initialRows.map((row) => (
            <li key={row.entryId} className="flex items-center gap-3 py-3">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-deck text-[12px] font-medium tabular-nums text-ink-2">
                #{row.position}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-ink">
                  {row.memberName}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {row.memberCode}
                  {row.requestedAt
                    ? ` · Requested ${formatDateIST(row.requestedAt)}`
                    : ""}
                </p>
              </div>
              {canManage ? (
                <div className="flex flex-none items-center gap-1">
                  {row.position === 1 ? (
                    <button
                      type="button"
                      onClick={() => run(() => promoteHeadAction({ batchId }))}
                      disabled={busy}
                      className="min-h-11 rounded-ctl border border-line bg-[var(--control-surface-action)] px-3 text-[13px] font-medium text-[var(--accent-ink)] disabled:opacity-50"
                    >
                      Promote next
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      run(() =>
                        cancelWaitlistAction({ memberId: row.memberId, batchId }),
                      )
                    }
                    disabled={busy}
                    aria-label={`Remove ${row.memberName}`}
                    className="min-h-11 px-2 text-[12px] text-ink-3 underline underline-offset-2 disabled:opacity-50"
                  >
                    Review removal
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="mt-1 text-[12.5px] text-ink-2">
          {error}
        </p>
      ) : null}
    </section>
  );
}
