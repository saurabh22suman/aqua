"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cancelSubscriptionAction,
  createSubscriptionAction,
  listMemberSubscriptionsAction,
  pauseSubscriptionAction,
  resumeSubscriptionAction,
} from "@/lib/actions/subscriptions";
import { listPlansAction } from "@/lib/actions/membership-plans";
import type { SubscriptionRow } from "@/lib/services/subscriptions";
import type { PlanRow } from "@/lib/services/membership-plans";
import { formatINR } from "@/lib/money/format";
import { Field } from "@/components/ui/Field";
import { DateField } from "@/components/ui/DateField";
import { Select } from "@/components/ui/Select";
import { RunwayStrip } from "@/components/ui/RunwayStrip";
import { formatDateIST, todayInZone } from "@/lib/time/tz";

// C-30 — a member's plans over time. Start a subscription from an
// active plan, pause/resume (pause extends the end date by the paused
// days), cancel. Independent of the member's own lifecycle status.

// C-32 — fired after any successful subscription change so the
// invoices panel can refresh its own client-side copy (a
// router.refresh() re-renders the server tree but keeps client state).
export const SUBSCRIPTIONS_CHANGED_EVENT = "aqua:subscriptions-changed";

function statusTone(status: SubscriptionRow["status"]): string {
  if (status === "active") return "bg-marine/10 text-marine";
  if (status === "paused") return "bg-deck text-ink-2";
  return "bg-deck text-ink-3";
}

const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionRow["status"], string> = {
  active: "Active",
  paused: "Paused",
  expired: "Expired",
  cancelled: "Cancelled",
};

function kindLabel(kind: string): string {
  if (kind === "duration") return "duration";
  if (kind === "sessions") return "session pack";
  return "one-time";
}


// PR3-C2 — runway arithmetic from real dates only (UTC day count).
function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty!, tm! - 1, td!) - Date.UTC(fy!, fm! - 1, fd!)) / 86_400_000,
  );
}

export function MemberSubscriptionPanel({
  memberId,
  canManage,
}: {
  memberId: string;
  // R10 (2026-10-13 role-workflow audit) — start/pause/resume/cancel
  // ride members.write. A reader without it keeps the plan view.
  canManage: boolean;
}) {
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[] | null>(
    null,
  );
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [startsValid, setStartsValid] = useState(true);
  const [endsValid, setEndsValid] = useState(true);

  // The academy's day, not the server's UTC day (staging blocker F15).
  // Between 00:00 and 05:29 IST the UTC date is still yesterday, which
  // under-counted the runway's used days by one.
  const today = todayInZone("Asia/Kolkata");

  const load = useCallback(async () => {
    try {
      const [rows, planRows] = await Promise.all([
        listMemberSubscriptionsAction(memberId),
        listPlansAction(),
      ]);
      setSubscriptions(rows);
      // One eligible array drives both the picker and its default. An
      // invoice-only or otherwise ineligible first row must never become the
      // selected plan.
      const eligible = planRows.filter((plan) =>
        ["duration", "term", "sessions"].includes(plan.kind),
      );
      setPlans(eligible);
      setPlanId((current) =>
        eligible.some((plan) => plan.id === current)
          ? current
          : (eligible[0]?.id ?? ""),
      );
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
        const result = await fn();
        setMessage(result.ok ? "Done." : result.error);
        if (result.ok) {
          await load();
          router.refresh();
          // Sibling panels (the invoices panel's raise picker) hold their
          // own client state; a server refresh does not remount them.
          window.dispatchEvent(new Event(SUBSCRIPTIONS_CHANGED_EVENT));
        }
      } catch {
        setMessage(
          "The change did not complete. The list below was refreshed — check it before retrying, in case the change already applied.",
        );
        await load().catch(() => setLoadError(true));
      } finally {
        setBusy(false);
      }
    })();
  }

  if (loadError) {
    return (
      <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
        <p className="text-[12px] text-ink-3">Could not load plans.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (subscriptions === null) {
    return (
      <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
        <p className="text-[12px] text-ink-3">Loading plans…</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
      <h2 className="font-display text-[16px] font-semibold text-ink">
        Paid plan
      </h2>
      <p className="mt-0.5 text-[12px] text-ink-3">
        Separate from academy participation — pausing one does not pause the
        other.
      </p>

      {subscriptions.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-3">
          No subscription yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {subscriptions.map((subscription) => (
            <li
              key={subscription.id}
              className="rounded-ctl border border-line px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[14px] font-medium text-ink">
                  {subscription.planName}
                  <span className="ml-2 text-[12px] text-ink-3">
                    {kindLabel(subscription.planKind)} ·{" "}
                    {formatINR(subscription.amountPaise)}
                  </span>
                </span>
                <span
                  data-testid="subscription-status"
                  className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${statusTone(subscription.status)}`}
                >
                  {SUBSCRIPTION_STATUS_LABEL[subscription.status]}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {formatDateIST(subscription.startsOn)} →{" "}
                {formatDateIST(subscription.endsOn)}
                {subscription.status === "paused" && subscription.pausedFrom
                  ? ` · paused from ${formatDateIST(subscription.pausedFrom)}`
                  : ""}
              </p>
              {subscription.status === "active" || subscription.status === "paused" ? (
                <div className="mt-2">
                  <RunwayStrip
                    label={`${subscription.planName} runway`}
                    startLabel={formatDateIST(subscription.startsOn)}
                    endLabel={formatDateIST(subscription.endsOn)}
                    usedDays={Math.max(
                      0,
                      Math.min(
                        daysBetween(subscription.startsOn, subscription.endsOn) + 1,
                        daysBetween(subscription.startsOn, today) + 1,
                      ),
                    )}
                    totalDays={Math.max(
                      1,
                      daysBetween(subscription.startsOn, subscription.endsOn) + 1,
                    )}
                  />
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {canManage && subscription.status === "active" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() => pauseSubscriptionAction({ id: subscription.id }))
                    }
                    className="inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"
                  >
                    Pause
                  </button>
                ) : null}
                {canManage && subscription.status === "paused" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() => resumeSubscriptionAction({ id: subscription.id }))
                    }
                    className="inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"
                  >
                    Resume
                  </button>
                ) : null}
                {canManage &&
                (subscription.status === "active" ||
                  subscription.status === "paused") ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm("Cancel this subscription?")) return;
                      run(() =>
                        cancelSubscriptionAction({ id: subscription.id }),
                      );
                    }}
                    className="inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!canManage ? null : plans.length === 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[12px] text-ink-3">
            No eligible membership plan. The owner can add a duration, term or
            session plan in Settings → Membership plans.
          </p>
          <button
            type="button"
            disabled
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent-strong)] opacity-60"
          >
            Start subscription
          </button>
        </div>
      ) : (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[12px] font-medium text-ink-2">
            Start a subscription
          </p>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-1">
              <Field id="member-subscription-plan" label="Plan">
                {(field) => (
                  <Select
                    {...field}
                    value={planId}
                    onChange={(e) => setPlanId(e.target.value)}
                  >
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} · {formatINR(plan.amountPaise)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Field id="member-subscription-starts" label="Starts (optional)">
              {(field) => (
                <DateField
                  {...field}
                  value={startsOn}
                  onChange={setStartsOn}
                  onValidityChange={setStartsValid}
                />
              )}
            </Field>
            <Field id="member-subscription-ends" label="Ends (optional)">
              {(field) => (
                <DateField
                  {...field}
                  value={endsOn}
                  onChange={setEndsOn}
                  onValidityChange={setEndsValid}
                />
              )}
            </Field>
          </div>
          <label
            htmlFor="member-subscription-auto-renew"
            className="mt-2 flex min-h-11 cursor-pointer items-start gap-2 rounded-ctl px-1 py-2.5 -mx-1 text-[12px] text-ink-2 hover:bg-deck/40"
          >
            <input
              id="member-subscription-auto-renew"
              type="checkbox"
              checked={autoRenew}
              onChange={(e) => setAutoRenew(e.target.checked)}
              className="mt-0.5 h-5 w-5 flex-none accent-[var(--accent-strong)]"
            />
            <span>Raise the next invoice automatically (payments stay manual)</span>
          </label>
          {!startsValid || !endsValid ? (
            <p role="alert" className="mt-1 text-[12px] text-ink-2">
              Enter a real date or clear the optional date before starting the
              subscription.
            </p>
          ) : null}
          <button
            type="button"
            disabled={
              busy ||
              plans.length === 0 ||
              !planId ||
              !startsValid ||
              !endsValid
            }
            onClick={() => {
              if (!planId || plans.length === 0 || !startsValid || !endsValid)
                return;
              run(() =>
                createSubscriptionAction({
                  memberId,
                  planId,
                  ...(startsOn ? { startsOn } : {}),
                  ...(endsOn ? { endsOn } : {}),
                  autoRenew,
                }),
              );
            }}
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-pill px-5 py-2 text-[13px] font-semibold text-paper bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Start subscription"}
          </button>
        </div>
      )}

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
