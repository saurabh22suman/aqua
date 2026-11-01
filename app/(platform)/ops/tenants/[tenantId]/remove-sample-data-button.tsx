"use client";

import { useActionState } from "react";
import { removeSampleDataAction } from "@/lib/actions/platform-remove-sample-data";
import {
  OpsWriteGate,
} from "@/components/ops/ops-display";
import { Button } from "@/components/ui/Button";

// Phase 2.3 — "Remove sample data" button on the tenant detail
// page. H1 — form uses <form action={removeSampleDataAction}>; the
// tenantId arrives as a hidden field and is re-validated server-side.
// Pre-hydration submit goes via POST to the action endpoint rather
// than falling through to a native GET.

export function RemoveSampleDataButton({
  tenantId,
  canWrite,
}: {
  tenantId: string;
  /** Resolved on the server from the session role. */
  canWrite: boolean;
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
      <OpsWriteGate
        canWrite={canWrite}
        note={
          <>
            Read-only: this account can browse, not change, platform data. An
            administrator can remove the seeded sample rows.
          </>
        }
      >
        {/* method="post" is pinned by scripts/e2e-platform-form-leak.ts;
            suppress the case-only hydration warning React raises for
            server-action forms (POST vs post). */}
        <form action={formAction} method="post" suppressHydrationWarning className="flex items-center gap-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={isPending}
          >
            {isPending ? "Removing…" : "Remove sample data"}
          </Button>
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
      </OpsWriteGate>
    </div>
  );
}