"use client";

import { useActionState, useState } from "react";
import { removeSampleDataAction } from "@/lib/actions/platform-remove-sample-data";
import {
  OpsWriteGate,
} from "@/components/ops/ops-display";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

// Phase 2.3 — "Remove sample data" button on the tenant detail
// page. H1 — form uses <form action={removeSampleDataAction}>; the
// tenantId arrives as a hidden field and is re-validated server-side.
// Pre-hydration submit goes via POST to the action endpoint rather
// than falling through to a native GET.

export function RemoveSampleDataButton({
  tenantId,
  tenantName,
  canWrite,
}: {
  tenantId: string;
  tenantName: string;
  /** Resolved on the server from the session role. */
  canWrite: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    removeSampleDataAction,
    null,
  );
  const [open, setOpen] = useState(false);

  const error =
    state && state.kind !== "ok" && "message" in state
      ? state.message
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
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Remove sample data
        </Button>
        <Dialog
          open={open}
          onOpenChange={(next) => { if (!isPending) setOpen(next); }}
          hideClose={isPending}
          title={`Remove sample data — ${tenantName}`}
          description="This permanently removes this tenant's sample programs, batches, skills, facilities, templates and related sessions. This cannot be undone."
        >
        {/* method="post" is pinned by scripts/e2e-platform-form-leak.ts;
            suppress the case-only hydration warning React raises for
            server-action forms (POST vs post). */}
        <form action={formAction} method="post" suppressHydrationWarning className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          {!done ? (
            <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
              {isPending ? "Removing…" : "Confirm removal"}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setOpen(false)}>
            {done ? "Done" : "Cancel"}
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
        </Dialog>
      </OpsWriteGate>
    </div>
  );
}
