"use client";

import { useActionState } from "react";
import { removeSampleDataAction } from "@/lib/actions/platform-remove-sample-data";

// Phase 2.3 — "Remove sample data" button on the tenant detail
// page. H1 — form uses <form action={removeSampleDataAction}>; the
// tenantId arrives as a hidden field and is re-validated server-side.
// Pre-hydration submit goes via POST to the action endpoint rather
// than falling through to a native GET.

export function RemoveSampleDataButton({
  tenantId,
}: {
  tenantId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    removeSampleDataAction,
    null,
  );

  const error =
    state && "kind" in state && state.kind === "error"
      ? (state as { kind: "error"; message: string }).message
      : null;
  const done =
    state && "kind" in state && state.kind === "ok"
      ? (state as { kind: "ok"; counts: Record<string, number> })
      : null;

  return (
    <div className="mt-2">
      <form action={formAction} method="post" className="flex items-center gap-3">
        <input type="hidden" name="tenantId" value={tenantId} />
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
            className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
          >
            {error}
          </p>
        ) : null}
        {done ? (
          <p
            role="status"
            className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
          >
            Removed {Object.values(done.counts).reduce((a, b) => a + b, 0)} sample rows.
          </p>
        ) : null}
      </form>
    </div>
  );
}