import type { OpsDeadLetterRow } from "@/db/platform-jobs";
import type { OpsFailedMessageRow } from "@/db/platform-messages";
import type { OpsNotificationAttentionRow } from "@/db/platform-notifications";
import { OpsStatusPill } from "@/components/ops/ops-display";
import { OpsCardFlush } from "@/components/ops/ops-primitives";
import { RecoveryRowControls } from "./recovery-row-controls";
import type { RecoveryCommitted, RecoveryRowKind } from "./recovery-data";
import { recoveryTime, shortId } from "./recovery-format";

// The three lists.
//
// Every field below is a field the masked platform projection already
// returns: a masked phone number, a classified reason, a status and a
// timestamp. Nothing here reads the message body, the raw phone, the
// provider's own error text or a job payload — those are not in the
// projection, so they cannot be shown even by accident.
//
// THE TWO LISTS HAVE DIFFERENT ID SPACES, and only one of them is
// actionable. The attention list is the OUTBOX projection, so its ids
// name recoverable notifications and it carries the recovery controls.
// The ledger list is the MESSAGE-LOG projection: its ids are message_log
// ids, which the audited retry/dismiss mutation does not address, so it
// stays evidence and carries NO control.

// Which recovery control a row can carry, if any.
//
// An unknown outcome can be resent or closed. A DEFINITELY failed
// notification (the projection returns failed rows only once the
// attempts ran out) can be retried or dismissed. Any other row is
// shown without a control, because the audited mutation would refuse
// it — a control that cannot work is worse than no control.
function recoveryKind(
  row: OpsNotificationAttentionRow,
): RecoveryRowKind | null {
  if (row.status === "unknown") return "unknown";
  if (row.status === "failed" && row.attempts >= 5) return "exhausted";
  return null;
}

// The unknown / exhausted notifications (the outbox projection).
//
// onCommitted is forwarded to EVERY row's controls: it is the console's
// single path back from a committed action, so the console can announce
// the outcome and re-read the actual list.
export function RecoveryAttentionList({
  rows,
  onCommitted,
}: {
  rows: OpsNotificationAttentionRow[];
  onCommitted?: RecoveryCommitted;
}) {
  return (
    <OpsCardFlush>
      <ul>
        {rows.map((row) => {
          const kind = recoveryKind(row);
          return (
            <li
              key={row.id}
              className="border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-[14px] font-medium text-ink">{row.tenantName}</p>
                <OpsStatusPill tone={row.status === "unknown" ? "warn" : "late"}>
                  {row.status}
                </OpsStatusPill>
              </div>
              <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                <RecoveryField label="Recipient" value={row.phoneMasked ?? "not recorded"} />
                <RecoveryField label="Event kind" value={row.eventKind ?? "not recorded"} />
                <RecoveryField label="Attempts" value={String(row.attempts)} />
                <RecoveryField label="Reason" value={row.failureReason ?? "not recorded"} />
              </dl>
              <p className="mt-1 text-[11px] text-ink-3">
                {recoveryTime(row.createdAt)} ·{" "}
                <span className="font-mono" title={row.id}>
                  {shortId(row.id)}
                </span>
                {row.claimedAt ? ` · claimed ${recoveryTime(row.claimedAt)}` : null}
              </p>
              {kind ? (
                <RecoveryRowControls
                  notificationId={row.id}
                  tenantId={row.tenantId}
                  kind={kind}
                  onCommitted={onCommitted}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </OpsCardFlush>
  );
}

// The failed attempts in the metered message ledger.
//
// EVIDENCE ONLY, and deliberately without a control. These rows are
// message_log records of attempts, so their ids are not the outbox ids
// the audited retry/dismiss mutation addresses (mutateExhausted selects
// whatsapp_notification_outbox by id). A control here would always be a
// no-op that reads as a recovery.
export function RecoveryFailedList({ rows }: { rows: OpsFailedMessageRow[] }) {
  return (
    <OpsCardFlush>
      <ul>
        {rows.map((row) => (
          <li key={row.id} className="border-b border-line px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-[14px] font-medium text-ink">{row.tenantName}</p>
              <OpsStatusPill tone="late">{row.status}</OpsStatusPill>
            </div>
            <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
              <RecoveryField label="Recipient" value={row.phoneMasked ?? "not recorded"} />
              <RecoveryField label="Provider" value={row.provider} />
              <RecoveryField label="Category" value={row.category} />
              <RecoveryField label="Consent" value={row.consentClass ?? "not recorded"} />
              <RecoveryField label="Reason" value={row.failureReason ?? "not recorded"} />
            </dl>
            <p className="mt-1 text-[11px] text-ink-3">
              {recoveryTime(row.createdAt)} ·{" "}
              <span className="font-mono" title={row.id}>
                {shortId(row.id)}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </OpsCardFlush>
  );
}

// The dead-letter queue's jobs: metadata only.
export function RecoveryDeadLetterList({ rows }: { rows: OpsDeadLetterRow[] }) {
  return (
    <OpsCardFlush>
      <ul>
        {rows.map((row) => (
          <li key={row.id} className="border-b border-line px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="font-mono text-[13px] text-ink">
                {row.sourceQueue ?? "queue not recorded"}
              </p>
              <OpsStatusPill tone="late">Dead-letter</OpsStatusPill>
            </div>
            <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
              <RecoveryField
                label="Tenant"
                value={row.tenantId ? shortId(row.tenantId) : "not recorded"}
              />
              <RecoveryField
                label="Attempts"
                value={row.attempts == null ? "not recorded" : String(row.attempts)}
              />
            </dl>
            <p className="mt-1 text-[11px] text-ink-3">
              {recoveryTime(row.createdAt)} ·{" "}
              <span className="font-mono" title={row.id}>
                {shortId(row.id)}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </OpsCardFlush>
  );
}

/**
 * One labelled value inside a row.
 *
 * The definition list is the semantic shape for a labelled value, and
 * it keeps the row readable at a glance: the label is quiet, the value
 * carries the ink.
 */
function RecoveryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-ink-3">{label}</dt>
      <dd className="font-medium text-ink-2">{value}</dd>
    </div>
  );
}
