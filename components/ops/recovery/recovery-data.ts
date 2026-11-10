// components/ops/recovery/recovery-data.ts
//
// The shapes the recovery console renders, and the ONE callback the
// write surface reports through.
//
// TYPES ONLY. Every import here is an `import type`, so nothing from the
// server side survives the compile: the server page, the client console
// and the client controller can share these shapes without dragging a
// server module into a client bundle.
//
// The two failure lists are DIFFERENT ID SPACES on purpose, and only
// the outbox one is actionable:
//
//   * OpsNotificationAttentionRow - db/platform-notifications.ts ->
//     ops_notification_attention. OUTBOX ids. A row is either an
//     UNKNOWN outcome (nobody recorded what happened) or a DEFINITELY
//     failed row whose attempts ran out.
//   * OpsFailedMessageRow         - db/platform-messages.ts ->
//     ops_failed_messages. MESSAGE_LOG ids. Evidence of attempts, not a
//     recoverable notification.
//   * OpsDeadLetterRow            - db/platform-jobs.ts. Job metadata
//     only, never a payload.

import type { OpsFailedMessageRow } from "@/db/platform-messages";
import type { OpsDeadLetterRow } from "@/db/platform-jobs";
import type { OpsNotificationAttentionRow } from "@/db/platform-notifications";
import type { DeadLetterReplayAvailability } from "@/lib/actions/platform-jobs";

/** Which lists could not be read. A list that failed is never shown as empty. */
export type RecoveryUnreadable = {
  attention: boolean;
  failed: boolean;
  deadLetter: boolean;
};

/** Everything the recovery console renders. */
export type RecoveryConsoleData = {
  /** The attention projection: unknown outcomes and exhausted failures. */
  attention: OpsNotificationAttentionRow[];
  /** The metered message ledger's failed attempts. Evidence only. */
  failed: OpsFailedMessageRow[];
  /** The dead-letter queue's jobs. */
  deadLetter: OpsDeadLetterRow[];
  /** The server's own statement about the replay limit. */
  replay: DeadLetterReplayAvailability | null;
  /** Which lists could not be read. */
  unreadable: RecoveryUnreadable;
};

/**
 * Which recovery control a row can carry.
 *
 * "unknown"   - the delivery outcome was never recorded. It can be
 *               resent or closed.
 * "exhausted" - the notification definitely failed and its attempts ran
 *               out. It can be retried or dismissed.
 */
export type RecoveryRowKind = "unknown" | "exhausted";

/**
 * Called after a committed action, with the outcome sentence.
 *
 * The console uses it for two things at once: it announces the result in
 * one place, and it RE-READS the actual list from the server. The
 * sentence travels WITH the callback because the row itself can
 * disappear from the re-read - the operator still has to be told what
 * happened to it.
 */
export type RecoveryCommitted = (message: string) => void | Promise<void>;
