import { MEMBER_STATUS_LABELS } from "@/lib/member-status-graph";
import type { MemberStatus } from "@/db/schema/people";
import { MemberManagementLink } from "@/components/member-detail/member-management-link";
import { StatusBadge, MEMBER_STATUS_TONE } from "@/components/ui/StatusBadge";

export function OwnerMemberSummary({ status, plans, balance, canManage, paymentsHref }: {
  status: MemberStatus;
  plans: Array<{ planName: string; status: string }> | null;
  balance?: string | null;
  canManage: boolean;
  paymentsHref?: string;
}) {
  return <div role="group" aria-label="Membership summary" className={`grid grid-cols-2 gap-3 ${balance !== undefined ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
    <section className="min-w-0 rounded-[18px] border border-line bg-paper p-[18px] lg:p-5">
      <h2 className="text-[13px] text-ink-3">Participation</h2>
      <p className="mt-2"><StatusBadge tone={MEMBER_STATUS_TONE[status] ?? "neutral"}>{MEMBER_STATUS_LABELS[status]}</StatusBadge></p>
      {canManage ? <MemberManagementLink target="participation">Manage participation</MemberManagementLink> : null}
    </section>
    {balance !== undefined ? <section className="min-w-0 rounded-[18px] border border-line bg-paper p-[18px] lg:p-5">
      <h2 className="text-[13px] text-ink-3">Outstanding</h2>
      <p className="mt-1 font-display text-[27px] font-semibold leading-tight tabular-nums text-ink [overflow-wrap:anywhere]">{balance ?? "Unavailable"}</p>
      {paymentsHref ? <a href={paymentsHref} className="mt-1 inline-flex min-h-11 items-center text-[13px] text-ink-2 underline underline-offset-2">View invoices</a> : null}
    </section> : null}
    <section className={`min-w-0 rounded-[18px] border border-line bg-paper p-[18px] lg:p-5 ${balance !== undefined ? "col-span-2 sm:col-span-1" : ""}`}>
      <h2 className="text-[13px] text-ink-3">Membership plan</h2>
      <p className="mt-1 break-words text-[14px] text-ink">{plans === null ? "Unavailable" : plans.length ? plans.map(plan => `${plan.planName} · ${plan.status}`).join(", ") : "No active or paused plan"}</p>
      {canManage ? <MemberManagementLink target="plan">Manage plan</MemberManagementLink> : null}
    </section>
  </div>;
}
