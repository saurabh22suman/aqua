"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  transitionTenantStatusAction,
  type TransitionFormInput,
} from "@/lib/actions/platform-tenants";

// Phase 1.6 — status transitions for the operator detail page. The
// full detail page is server-rendered; this island owns the only
// client-side state on it (the in-flight submit + inline error).
//
// The state machine (mirrors db/platform-tenant-status.ts):
//   trial      → "Activate" / "Suspend" / "Churn"
//   active     → "Suspend" / "Churn"
//   suspended  → "Reactivate" / "Churn"
//   churned    → (terminal, no controls)
//
// Suspend and churn demand a reason — the modal collects it
// inline. The audit row carries the reason and surfaces in the
// detail page's `recentActivity` timeline.

type Action = "tenant.activate" | "tenant.suspend" | "tenant.churn";
type Target = "active" | "suspended" | "churned";

const TARGET_BY_BUTTON: Record<Action, Target> = {
  "tenant.activate": "active",
  "tenant.suspend": "suspended",
  "tenant.churn": "churned",
};

const BUTTON_LABEL: Record<Action, string> = {
  "tenant.activate": "Reactivate",
  "tenant.suspend": "Suspend",
  "tenant.churn": "Mark churned",
};

function buttonClass(action: Action): string {
  // Status actions are operator workflow controls, not money or
  // attendance state — DESIGN.md §1.1 reserves warn / late / water
  // for those meanings. We use the accent token (the only token
  // DESIGN.md §1.2 explicitly endorses for non-status primary
  // actions) and the neutral ink palette for the rest. The label is
  // the source of truth.
  if (action === "tenant.churn") {
    return "rounded-pill px-4 py-2 text-[13px] font-medium text-paper bg-ink-2 hover:bg-ink transition-colors duration-150";
  }
  if (action === "tenant.suspend") {
    return "rounded-pill px-4 py-2 text-[13px] font-medium text-ink-2 border border-line hover:bg-deck transition-colors duration-150";
  }
  return "rounded-pill px-4 py-2 text-[13px] font-medium text-paper bg-[var(--accent)] hover:opacity-90 transition-colors duration-150";
}

export function StatusTransitionControls({
  tenantId,
  currentStatus,
}: {
  tenantId: string;
  currentStatus: "trial" | "active" | "suspended" | "churned";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");

  function available(): Action[] {
    if (currentStatus === "trial") {
      return ["tenant.activate", "tenant.suspend", "tenant.churn"];
    }
    if (currentStatus === "active") {
      return ["tenant.suspend", "tenant.churn"];
    }
    if (currentStatus === "suspended") {
      return ["tenant.activate", "tenant.churn"];
    }
    return []; // churned — terminal
  }

  function reset() {
    setError(null);
    setPendingAction(null);
    setReason("");
  }

  function submit(action: Action) {
    if (action === "tenant.suspend" || action === "tenant.churn") {
      // Open the reason capture first; the actual submit runs
      // from the modal confirm.
      setPendingAction(action);
      setError(null);
      return;
    }
    runSubmit(action, "");
  }

  function confirmWithReason() {
    if (!pendingAction) return;
    if (!reason.trim()) {
      setError("Reason is required for this status change.");
      return;
    }
    runSubmit(pendingAction, reason.trim());
  }

  function runSubmit(action: Action, theReason: string) {
    const target = TARGET_BY_BUTTON[action];
    const input: TransitionFormInput = {
      targetStatus: target,
      ...(theReason ? { reason: theReason } : {}),
    };
    startTransition(async () => {
      const result = await transitionTenantStatusAction(tenantId, input);
      if (result.kind === "ok") {
        reset();
        // Refresh the page so the new status pill, the new
        // activity row, and the updated audit trail all reflect
        // the change. router.refresh() re-runs server components.
        router.refresh();
        return;
      }
      // Even on error, keep the reason-typed modal open so the
      // operator can correct the input without re-entering it.
      setError(result.message);
    });
  }

  const actions = available();

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            disabled={isPending}
            onClick={() => submit(a)}
            className={buttonClass(a)}
          >
            {BUTTON_LABEL[a]}
          </button>
        ))}
        {actions.length === 0 ? (
          <span className="text-[13px] text-ink-3">
            No transitions available — churned is terminal.
          </span>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-ctl border border-late bg-late-soft px-3 py-2 text-[13px] text-late"
        >
          {error}
        </p>
      ) : null}

      {pendingAction ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Confirm ${BUTTON_LABEL[pendingAction]}`}
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-marine/30 px-4 py-6"
          onClick={(e) => {
            if (e.currentTarget === e.target) reset();
          }}
        >
          <div className="w-full max-w-md rounded-card bg-paper border border-line p-5">
            <p className="font-display text-[16px] font-semibold text-ink">
              {BUTTON_LABEL[pendingAction]} — confirm
            </p>
            <p className="mt-1 text-[13px] text-ink-2">
              {pendingAction === "tenant.suspend"
                ? "Pausing blocks tenant sign-ins and surfaces a clear message on the login screen."
                : "Marking churned terminates the tenant. Members cannot sign in after this. The transition cannot be undone."}
            </p>
            <label className="mt-4 block">
              <span className="block text-[13px] font-medium text-ink-2">
                Reason
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                required
                rows={3}
                placeholder="What triggered this?"
                className="mt-1 w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] text-ink placeholder:text-ink-3 focus:border-[var(--accent)] focus:outline-none"
              />
              <span className="mt-1 block text-[12px] text-ink-3">
                Required. Saved on the platform audit log so the timeline
                explains the change.
              </span>
            </label>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                disabled={isPending}
                onClick={confirmWithReason}
                className="rounded-pill px-5 py-2.5 text-[14px] font-semibold text-white bg-[var(--accent)] transition-colors duration-150 disabled:opacity-60"
              >
                {isPending ? "Saving…" : `Confirm ${BUTTON_LABEL[pendingAction]}`}
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-pill px-4 py-2.5 text-[13px] font-medium text-ink-2 hover:text-ink hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
