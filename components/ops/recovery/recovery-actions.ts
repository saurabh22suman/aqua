// components/ops/recovery/recovery-actions.ts
//
// The FOUR canonical recovery controls, described once.
//
// Every control names an EXISTING audited server action, the EXISTING
// FormData keys it is called with (notificationId, tenantId, reason -
// the mutationInput schema in lib/actions/platform-notifications.ts),
// and what the operator is told when it runs and when it has committed.
//
// NOTHING HERE IS A NEW OPERATION OR A NEW PERMISSION. The actions
// re-check the operator on the server (requireOpsAdminAction); this
// module only describes them.
//
// THE TRUTH RULES live with the control they belong to, because they
// are per ACTION, not per row kind:
//
//   * a resend or a retry QUEUES another attempt. It never says the
//     message was delivered, because nothing knows that;
//   * a close or a dismissal ENDS the queueing of that notification. It
//     is a manual investigation decision, not a delivery confirmation;
//   * only the UNKNOWN resend carries the duplicate-delivery risk, so
//     only it is gated by the acknowledgement - closing an unknown row
//     carries no such ambiguity.

import {
  closeUnknownNotificationAction,
  resendUnknownNotificationAction,
} from "@/lib/actions/platform-notifications";
import {
  dismissFailedNotificationAction,
  retryFailedNotificationAction,
} from "@/lib/actions/platform-failed-notifications";
import type { RecoveryRowKind } from "./recovery-data";

/** The canonical result shape the four audited actions return. */
export type RecoveryAction = (
  previous: unknown,
  formData: FormData,
) => Promise<
  | { ok: true; value: { status: string } }
  | { ok: false; error: string }
>;

/** Which canonical action a control runs. */
export type RecoveryVerb = "resend" | "close" | "retry" | "dismiss";

export type RecoveryControl = {
  verb: RecoveryVerb;
  /** The button label: the verb the operator is choosing. */
  label: string;
  action: RecoveryAction;
  /**
   * Only the UNKNOWN resend carries the duplicate-delivery risk, so
   * only it is gated by the acknowledgement.
   */
  duplicateRisk: boolean;
  /** What the operator is told while the action is in flight. */
  pending: string;
  /**
   * The sentence shown once the action has committed.
   *
   * A close and a dismiss do not queue anything, so they must never
   * say they did.
   */
  committed: string;
};

/**
 * The two controls a row of this kind can carry.
 *
 * The order is the one the operator reads: the action that tries again
 * first, the action that ends the matter second.
 */
export function controlsFor(
  kind: RecoveryRowKind,
): [RecoveryControl, RecoveryControl] {
  if (kind === "unknown") {
    return [
      {
        verb: "resend",
        label: "Resend",
        action: resendUnknownNotificationAction,
        duplicateRisk: true,
        pending: "Resending…",
        committed:
          "Queued for another attempt. The original outcome was never recorded, so the recipient may receive this message again.",
      },
      {
        verb: "close",
        label: "Close",
        action: closeUnknownNotificationAction,
        duplicateRisk: false,
        pending: "Closing…",
        committed:
          "Closed. This notification will not be queued again. That is a manual investigation decision, not a delivery confirmation.",
      },
    ];
  }
  return [
    {
      verb: "retry",
      label: "Retry",
      action: retryFailedNotificationAction,
      duplicateRisk: false,
      pending: "Retrying…",
      committed: "Queued for another attempt.",
    },
    {
      verb: "dismiss",
      label: "Dismiss",
      action: dismissFailedNotificationAction,
      duplicateRisk: false,
      pending: "Dismissing…",
      committed:
        "Dismissed. This notification will not be queued again. That is a manual investigation decision, not a delivery confirmation.",
    },
  ];
}
