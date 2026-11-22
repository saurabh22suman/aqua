"use client";

// The Ops recovery console.
//
// Three investigation sections, in the order an operator asks the
// question: what is UNKNOWN (nobody recorded the outcome), what FAILED
// outright (the provider refused, or the attempts ran out), and what
// STOPPED (queued work moved aside after repeated failure).
//
// Every value on screen comes from a masked platform projection, so the
// console can show WHAT happened without ever showing the message body,
// the raw phone number, the provider's own error text or a job payload.
//
// THE WRITE SURFACE.
//
// The console is NOT read-only. An administrator can recover a
// notification: an unknown outcome can be resent or closed, and a
// definitively failed notification can be retried or dismissed. Each of
// those is a REASON-REQUIRED, audited server action that already exists
// (lib/actions/platform-notifications.ts and
// lib/actions/platform-failed-notifications.ts); this surface only calls
// them, with their own FormData keys.
//
// Three things the surface does not do:
//   * it never claims a message was delivered — an unknown outcome means
//     nobody recorded what happened, and a close or a dismiss is a manual
//     investigation decision, not a delivery confirmation;
//   * it never offers a control for the message-ledger list, whose ids
//     are message_log ids rather than the outbox ids those actions
//     address;
//   * it never removes a row on its own. After a committed action the
//     console RE-READS the actual list through the existing audited
//     read, so what is on screen is what the server holds.
//
// THE ADMIN GATE IS NOT HERE: app/(platform)/ops/recovery/page.tsx
// refuses every non-administrator before any platform read, and each
// action re-checks the operator's role on the server. A value sent by a
// caller decides nothing here.

import { useState } from "react";
import {
  OpsEmptyState,
  OpsPage,
  OpsPageHeader,
  OpsPanel,
  OpsSection,
} from "@/components/ops/ops-primitives";
import { listNotificationsNeedingAttentionAction } from "@/lib/actions/platform-notifications";
import {
  RecoveryAttentionList,
  RecoveryDeadLetterList,
  RecoveryFailedList,
} from "./recovery-lists";
import type { RecoveryCommitted, RecoveryConsoleData } from "./recovery-data";

// The public surface of this module is unchanged: the console, its data
// type, and the refusal all stay importable from
// "@/components/ops/recovery/recovery-console".
export type { RecoveryConsoleData, RecoveryUnreadable } from "./recovery-data";
export { RecoveryRefusal } from "./recovery-refusal";

/** The same slice the page reads, so a re-read shows the same rows. */
const LIMIT = 50;

export function RecoveryConsole({ data }: { data: RecoveryConsoleData }) {
  const [attention, setAttention] = useState(data.attention);
  const [unreadable, setUnreadable] = useState(data.unreadable);
  const [notice, setNotice] = useState<string | null>(null);

  // The attention projection returns two kinds of row in ONE list: an
  // unknown outcome, and a definitively failed notification whose
  // attempts ran out. They are different questions, so they are
  // different sections.
  const unknownRows = attention.filter((row) => row.status === "unknown");
  const exhaustedRows = attention.filter((row) => row.status !== "unknown");

  // A list that could not be read is never shown as an empty one.
  const failedIsEmpty =
    !unreadable.attention &&
    !unreadable.failed &&
    exhaustedRows.length === 0 &&
    data.failed.length === 0;

  /**
   * Re-read the ACTUAL list after a committed action.
   *
   * The row is not removed locally: the server decides whether it is
   * still an unknown outcome or an exhausted failure, and the console
   * shows that answer. A read that fails marks the list unreadable,
   * which is reported rather than presented as empty.
   */
  async function rereadAttention(): Promise<void> {
    const formData = new FormData();
    formData.set("limit", String(LIMIT));
    try {
      const result = await listNotificationsNeedingAttentionAction(null, formData);
      if (result.ok) {
        setAttention(result.value);
        setUnreadable((current) => ({ ...current, attention: false }));
      } else {
        setAttention([]);
        setUnreadable((current) => ({ ...current, attention: true }));
      }
    } catch {
      setAttention([]);
      setUnreadable((current) => ({ ...current, attention: true }));
    }
  }

  /**
   * The one path back from a committed action.
   *
   * It announces what happened — in the console, so the announcement
   * outlives the row it belongs to — and then awaits the canonical
   * re-read. Nothing is patched locally.
   */
  const onCommitted: RecoveryCommitted = async (message) => {
    setNotice(message);
    await rereadAttention();
  };

  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Investigation"
        title="Recovery"
        lede="Investigate unknown message outcomes, failed sends and dead-letter jobs, and recover the notifications that can still be recovered."
        meta="Live read · never cached"
      />

      <OpsPanel tone="pending" className="mt-6" title="What you can change here">
        Contact details are masked. Message bodies, provider errors and job
        payloads are excluded from this view. Each list shows a recent slice
        of records; older records may fall outside these results. Recovering
        a notification needs a reason and is recorded on the platform audit
        log; the dead-letter queue stays read-only.
      </OpsPanel>

      {notice ? (
        <p role="status" className="mt-4 text-[13px] text-ink-2">
          {notice}
        </p>
      ) : null}

      <section className="mt-8">
        <OpsSection
          title="Unknown outcomes"
          subtitle="Notifications whose delivery outcome was never recorded — the message may or may not have reached the recipient. The projection returns at most fifty rows in total, shared with Failed sends."
          actions={<RowCount count={unreadable.attention ? null : unknownRows.length} />}
        />
        {unreadable.attention ? (
          <OpsPanel tone="error" title="This list could not be read">
            The platform refused or failed the read, so nothing is shown
            here. No records were changed.
          </OpsPanel>
        ) : unknownRows.length === 0 ? (
          <OpsEmptyState
            title="No unknown outcomes"
            body="No unknown notifications appear in these recent results. Older records may be outside this list."
          />
        ) : (
          <RecoveryAttentionList rows={unknownRows} onCommitted={onCommitted} />
        )}
      </section>

      <section className="mt-8">
        <OpsSection
          title="Failed sends"
          subtitle="Definite failures: the provider refused the send, or a notification's attempts ran out. The ledger list shows the newest fifty failed attempts."
          actions={
            <RowCount
              count={
                unreadable.attention || unreadable.failed
                  ? null
                  : exhaustedRows.length + data.failed.length
              }
            />
          }
        />
        {unreadable.attention ? (
          <OpsPanel tone="error" title="The notifications list could not be read">
            The platform refused or failed the read, so nothing is shown
            for it. No records were changed.
          </OpsPanel>
        ) : null}
        {unreadable.failed ? (
          <OpsPanel tone="error" title="The message ledger list could not be read">
            The platform refused or failed the read, so nothing is shown
            for it. No records were changed.
          </OpsPanel>
        ) : null}
        {!unreadable.attention && exhaustedRows.length > 0 ? (
          <>
            {/* The shared Ops frame has no third-level heading, so this
                label keeps the document outline right without inventing a
                new primitive. */}
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
              Notifications whose attempts ran out
            </h3>
            <RecoveryAttentionList rows={exhaustedRows} onCommitted={onCommitted} />
          </>
        ) : null}
        {data.failed.length > 0 ? (
          <>
            <h3 className="mb-2 mt-5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
              Failed message attempts
            </h3>
            <RecoveryFailedList rows={data.failed} />
          </>
        ) : null}
        {failedIsEmpty ? (
          <OpsEmptyState
            title="No definite failures"
            body="No definite failures appear in these recent results. Check unknown outcomes separately; older records may be outside these lists."
          />
        ) : null}
      </section>

      <section className="mt-8">
        <OpsSection
          title="Dead-letter jobs"
          subtitle="Queued work the scheduler moved aside after repeated failure. Only safe metadata is shown; payloads, output and error text are excluded from this view."
          actions={<RowCount count={unreadable.deadLetter ? null : data.deadLetter.length} />}
        />
        {data.replay ? (
          <OpsPanel tone="pending" className="mb-4" title="Dead-letter replay">
            {data.replay.reason}
          </OpsPanel>
        ) : null}
        {unreadable.deadLetter ? (
          <OpsPanel tone="error" title="This list could not be read">
            The platform refused or failed the read, so nothing is shown
            here. No records were changed.
          </OpsPanel>
        ) : data.deadLetter.length === 0 ? (
          <OpsEmptyState
            title="The dead-letter queue is empty"
            body="No queued work has been moved aside after repeated failure."
          />
        ) : (
          <RecoveryDeadLetterList rows={data.deadLetter} />
        )}
      </section>
    </OpsPage>
  );
}

/** The count beside a section heading: how many rows are on screen. */
function RowCount({ count }: { count: number | null }) {
  return (
    <span className="text-[12px] text-ink-3">
      {count === null ? "Unavailable" : `${count} ${count === 1 ? "row" : "rows"}`}
    </span>
  );
}
