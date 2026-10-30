"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  transitionTenantStatusAction,
  type TransitionFormInput,
} from "@/lib/actions/platform-tenants";
import { buttonClasses } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import {
  OpsWriteGate,
} from "@/components/ops/ops-display";

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
  "tenant.activate": "Activate",
  "tenant.suspend": "Suspend",
  "tenant.churn": "Mark churned",
};

// The label depends on WHERE THE TENANT IS COMING FROM: a trial
// tenant needs "Activate"; a SUSPENDED tenant needs "Reactivate",
// because it was switched off. Offering "Reactivate" to a trial
// tenant described an action the tenant had never been in.
function buttonLabel(action: Action, currentStatus: string): string {
  if (action === "tenant.activate") {
    return currentStatus === "suspended" ? "Reactivate" : "Activate";
  }
  return BUTTON_LABEL[action];
}

function buttonClass(action: Action): string {
  // 2026-09-13 UI/UX audit §7.2 — "Mark churned" is destructive and
  // hard to reverse, but was styled as a plain neutral button. It now
  // uses the shared destructive variant (`late` token) while suspend
  // stays a neutral secondary and reactivate is the accent primary.
  // The confirm dialog still gates churn/suspend behind a reason.
  if (action === "tenant.churn") {
    return buttonClasses({ variant: "destructive" });
  }
  if (action === "tenant.suspend") {
    return buttonClasses({ variant: "secondary" });
  }
  return buttonClasses({ variant: "primary" });
}

export function StatusTransitionControls({
  tenantId,
  currentStatus,
  canWrite,
}: {
  tenantId: string;
  currentStatus: "trial" | "active" | "suspended" | "churned";
  /**
   * Resolved on the server from the session role. A viewer gets the
   * state and the reason it cannot change it — never a control that
   * would fail on submit. The action still refuses a forged write.
   */
  canWrite: boolean;
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
      <OpsWriteGate
        canWrite={canWrite}
        note={
          <>
            Read-only: this account can browse, not change, platform data.
            The tenant&apos;s status is {currentStatus}.
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              disabled={isPending}
              onClick={() => submit(a)}
              className={buttonClass(a)}
            >
              {buttonLabel(a, currentStatus)}
            </button>
          ))}
          {actions.length === 0 ? (
            <span className="text-[13px] text-ink-3">
              No transitions available — churned is terminal.
            </span>
          ) : null}
        </div>
      </OpsWriteGate>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {error}
        </p>
      ) : null}

      {pendingAction ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Confirm ${buttonLabel(pendingAction, currentStatus)}`}
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-marine/30 px-4 py-6"
          onClick={(e) => {
            if (e.currentTarget === e.target) reset();
          }}
        >
          <div className="w-full max-w-md rounded-card bg-paper border border-line p-5">
            <p className="font-display text-[16px] font-semibold text-ink">
              {buttonLabel(pendingAction, currentStatus)} — confirm
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
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                required
                rows={3}
                placeholder="What triggered this?"
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
                className={buttonClasses({
                  variant:
                    pendingAction === "tenant.churn" ? "destructive" : "primary",
                  size: "md",
                })}
              >
                {isPending ? "Saving…" : `Confirm ${buttonLabel(pendingAction, currentStatus)}`}
              </button>
              <button
                type="button"
                onClick={reset}
                className={buttonClasses({ variant: "ghost", size: "sm" })}
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
