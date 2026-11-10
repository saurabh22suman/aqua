"use client";

import { useActionState } from "react";
import {
  assignTenantPlanAction,
} from "@/lib/actions/platform-tenant-plan";
import {
  setTenantTrialDeadlineAction,
} from "@/lib/actions/platform-tenant-trial";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { IST_TIME_ZONE } from "@/lib/time/calendar";
import { formatWallTime24hIST, todayInZone } from "@/lib/time/tz";

/** The IST wall time of an instant, in the shape the control takes. */
function istWallTime(instant: Date): string {
  const day = todayInZone(IST_TIME_ZONE, instant.getTime());
  return `${day}T${formatWallTime24hIST(instant)}`;
}

export function PlanCommercialControls({
  tenantId,
  currentPlanId,
  currentPlanName,
  eligiblePlans,
  currentTrialExpiresAt,
  canWrite,
}: {
  tenantId: string;
  /** The plan the club is on now (null when it has none). */
  currentPlanId: string | null;
  currentPlanName: string | null;
  /** The active, signup-eligible plans — the only reassignment targets. */
  eligiblePlans: ReadonlyArray<{ key: string; name: string }>;
  currentTrialExpiresAt: Date | null;
  /** Resolved on the server from the session role. */
  canWrite: boolean;
}) {
  const [planState, planAction, planPending] = useActionState(
    assignTenantPlanAction,
    null,
  );
  const [trialState, trialAction, trialPending] = useActionState(
    setTenantTrialDeadlineAction,
    null,
  );

  const planError =
    planState && "kind" in planState && planState.kind === "refused"
      ? planState.message
      : null;
  const trialError =
    trialState && "kind" in trialState && trialState.kind === "refused"
      ? trialState.message
      : null;

  return (
    <div className="space-y-6 px-4 py-4">
      <section>
        <h3 className="text-[14px] font-medium text-ink">Plan</h3>
        <p className="mt-1 text-[13px] text-ink-2">
          This club is on{" "}
          <span className="font-medium">{currentPlanName ?? "no plan"}</span>.
          Changing the plan moves the club to another plan: the club&apos;s own
          per-tenant feature overrides are kept, no data is deleted, no
          commercial quota is enforced and nothing is billed.
        </p>
        {canWrite ? (
          <form action={planAction} method="post" suppressHydrationWarning className="mt-3 space-y-3">
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="expectedPlanId" value={currentPlanId ?? ""} />
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                Move to plan
              </span>
              <Select name="planKey" defaultValue="" aria-label="Move to plan">
                <option value="">Choose a plan…</option>
                {eligiblePlans.map((plan) => (
                  <option key={plan.key} value={plan.key}>
                    {plan.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                Reason for the plan change
              </span>
              <Textarea
                name="reason"
                rows={2}
                required
                aria-label="Reason for the plan change"
                placeholder="Why this club is moving now."
              />
            </label>
            {planError ? (
              <p role="alert" className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2">
                {planError}
              </p>
            ) : null}
            <Button type="submit" variant="primary" size="sm" disabled={planPending}>
              Change plan
            </Button>
          </form>
        ) : null}
      </section>

      <section>
        <h3 className="text-[14px] font-medium text-ink">Trial deadline</h3>
        <p className="mt-1 text-[13px] text-ink-2">
          This deadline is manual: setting it does not activate, suspend or bill
          the club. There is no default trial length — the deadline is the
          moment you enter, read as IST (Asia/Kolkata), and emptying the field
          removes it.
        </p>
        {canWrite ? (
          <form action={trialAction} method="post" suppressHydrationWarning className="mt-3 space-y-3">
            <input type="hidden" name="tenantId" value={tenantId} />
            <input
              type="hidden"
              name="expectedExpiresAt"
              value={currentTrialExpiresAt ? currentTrialExpiresAt.toISOString() : ""}
            />
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                Trial deadline (optional)
              </span>
              <Input
                name="expiresAtIst"
                type="datetime-local"
                defaultValue={currentTrialExpiresAt ? istWallTime(currentTrialExpiresAt) : ""}
                aria-label="Trial deadline (optional)"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">
                Reason for the deadline change
              </span>
              <Textarea
                name="reason"
                rows={2}
                required
                aria-label="Reason for the deadline change"
                placeholder="Why this deadline is being recorded."
              />
            </label>
            {trialError ? (
              <p role="alert" className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2">
                {trialError}
              </p>
            ) : null}
            <Button type="submit" variant="primary" size="sm" disabled={trialPending}>
              Save deadline
            </Button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
