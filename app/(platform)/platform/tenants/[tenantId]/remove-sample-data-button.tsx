"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeSampleDataAction } from "@/lib/actions/platform-remove-sample-data";

// Phase 2.3 — "Remove sample data" button on the tenant detail
// page. The parent page renders this client island only when
// (hasSample && !hasReal). The button calls
// `removeSampleDataAction` and reflects the result.
//
// One dominant element per the page: the StatusTransitionControls
// (the main operator control) is the saturated colour. This button
// uses neutral-ink with a subtle border — destructive, but not the
// primary action. The form-pattern is a single button + inline
// status; the operator is the platform admin, the page is theirs.

export function RemoveSampleDataButton({
  tenantId,
}: {
  tenantId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ counts: Record<string, number> } | null>(
    null,
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await removeSampleDataAction({ tenantId });
      if (result.kind === "ok") {
        setDone({ counts: result.counts });
        router.refresh();
        return;
      }
      if (result.kind === "lock_active") {
        setError(result.message);
        return;
      }
      if (result.kind === "tenant_not_found") {
        setError("Tenant not found. Refresh the page.");
        return;
      }
      if (result.kind === "error") {
        setError(result.message);
        return;
      }
    });
  }

  return (
    <div className="mt-2">
      <form onSubmit={onSubmit} className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-pill px-4 py-2 text-[13px] font-medium text-ink-2 border border-line hover:bg-deck disabled:opacity-60 transition-colors duration-150"
        >
          {isPending ? "Removing…" : "Remove sample data"}
        </button>
        {error ? (
          <p
            role="alert"
            className="rounded-ctl border border-late bg-late-soft px-3 py-2 text-[13px] text-late"
          >
            {error}
          </p>
        ) : null}
        {done ? (
          <p
            role="status"
            className="rounded-ctl border border-good bg-good-soft px-3 py-2 text-[13px] text-good"
          >
            Removed {Object.values(done.counts).reduce((a, b) => a + b, 0)} sample rows.
          </p>
        ) : null}
      </form>
    </div>
  );
}
