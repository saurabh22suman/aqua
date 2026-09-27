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
import { RunwayStrip } from "@/components/ui/RunwayStrip";
import { formatDateIST } from "@/lib/time/tz";

// C-30 — a member's plans over time. Start a subscription from an
// active plan, pause/resume (pause extends the end date by the paused
// days), cancel. Independent of the member's own lifecycle status.

// C-32 — fired after any successful subscription change so the
// invoices panel can refresh its own client-side copy (a
// router.refresh() re-renders the server tree but keeps client state).
export const SUBSCRIPTIONS_CHANGED_EVENT = "aqua:subscriptions-changed";

const inputClass =
  "w-full min-h-11 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

function statusTone(status: SubscriptionRow["status"]): string {
  if (status === "active") return "bg-marine/10 text-marine";
  if (status === "paused") return "bg-deck text-ink-2";
  return "bg-deck text-ink-3";
}

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

export function MemberSubscriptionPanel({ memberId }: { memberId: string }) {
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

  const load = useCallback(async () => {
    try {
      const [rows, planRows] = await Promise.all([
        listMemberSubscriptionsAction(memberId),
        listPlansAction(),
      ]);
      setSubscriptions(rows);
      setPlans(
        planRows.filter((plan) =>
          ["duration", "term", "sessions"].includes(plan.kind),
        ),
      );
      setPlanId((current) => current || planRows[0]?.id || "");
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
      const result = await fn();
      setMessage(result.ok ? "Done." : result.error);
      if (result.ok) {
        await load();
        router.refresh();
        // Sibling panels (the invoices panel's raise picker) hold their
        // own client state; a server refresh does not remount them.
        window.dispatchEvent(new Event(SUBSCRIPTIONS_CHANGED_EVENT));
      }
      setBusy(false);
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
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        Membership
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
                  className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${statusTone(subscription.status)}`}
                >
                  {subscription.status}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {subscription.startsOn} → {subscription.endsOn}
                {subscription.status === "paused" && subscription.pausedFrom
                  ? ` · paused from ${subscription.pausedFrom}`
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
                        daysBetween(subscription.startsOn, new Date().toISOString().slice(0, 10)) + 1,
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
                {subscription.status === "active" ? (
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
                {subscription.status === "paused" ? (
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
                {subscription.status === "active" ||
                subscription.status === "paused" ? (
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

      {plans.length === 0 ? (
        <p className="mt-3 text-[12px] text-ink-3">
          No active plans. The owner can price one in Settings → Membership
          plans.
        </p>
      ) : (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[12px] font-medium text-ink-2">
            Start a subscription
          </p>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="block sm:col-span-1">
              <span className="block text-[11px] text-ink-3 mb-0.5">Plan</span>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className={inputClass}
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {formatINR(plan.amountPaise)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink-3 mb-0.5">
                Starts (optional)
              </span>
              <input
                type="date"
                lang="en-IN"
                placeholder="dd/mm/yyyy"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink-3 mb-0.5">
                Ends (optional)
              </span>
              <input
                type="date"
                lang="en-IN"
                placeholder="dd/mm/yyyy"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <label className="mt-2 flex items-center gap-2 text-[12px] text-ink-2">
            <input
              type="checkbox"
              checked={autoRenew}
              onChange={(e) => setAutoRenew(e.target.checked)}
            />
            Raise the next invoice automatically (payments stay manual)
          </label>
          <button
            type="button"
            disabled={busy || plans.length === 0}
            onClick={() =>
              run(() =>
                createSubscriptionAction({
                  memberId,
                  planId,
                  ...(startsOn ? { startsOn } : {}),
                  ...(endsOn ? { endsOn } : {}),
                  autoRenew,
                }),
              )
            }
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
