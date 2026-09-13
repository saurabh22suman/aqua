"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListOrdered, Trash2 } from "lucide-react";
import {
  cancelWaitlistAction,
  promoteHeadAction,
} from "@/lib/actions/waitlist";
import type { WaitlistRow } from "@/lib/services/waitlist";
import { EmptyState } from "@/components/ui/EmptyState";

// R.5 (docs/five-day-work-guide.md) — the batch-side waitlist queue.
// Members join from the member detail enrolment panel when a batch is
// full; this board is where staff see the queue and promote the head.
// Known gap carried from the service: promotion does not re-check
// capacity (logged in the work guide); the button is manual on
// purpose until that guard lands.
export function WaitlistBoard({
  batchId,
  initialRows,
}: {
  batchId: string;
  initialRows: WaitlistRow[];
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
    <section className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
          <ListOrdered size={15} className="text-ink-3" />
          Waitlist
        </h2>
        {initialRows.length > 0 ? (
          <button
            type="button"
            onClick={() => run(() => promoteHeadAction({ batchId }))}
            disabled={busy}
            className="rounded-ctl border border-line bg-deck px-3 min-h-[44px] text-[12.5px] font-medium text-ink-2 disabled:opacity-50"
          >
            Promote next
          </button>
        ) : null}
      </div>

      {initialRows.length === 0 ? (
        <div className="mt-2 rounded-ctl border border-line bg-paper">
          <EmptyState
            title="No one is waiting"
            body="When a batch is full, staff can add a member to this queue from their profile."
          />
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
          {initialRows.map((row) => (
            <li key={row.entryId} className="flex items-center gap-3 px-3.5 py-3">
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-deck text-[11.5px] font-medium text-ink-3">
                #{row.position}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">
                  {row.memberName}
                </p>
                <p className="text-[11.5px] text-ink-3">{row.memberCode}</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  run(() =>
                    cancelWaitlistAction({ memberId: row.memberId, batchId }),
                  )
                }
                disabled={busy}
                aria-label={`Remove ${row.memberName}`}
                className="flex h-11 w-11 flex-none items-center justify-center rounded-ctl text-ink-3 disabled:opacity-50"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="mt-1 text-[12px] text-ink-2">{error}</p> : null}
    </section>
  );
}
