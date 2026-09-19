import { Palmtree } from "lucide-react";
import {
  listLeaveTypesAction,
  listMyLeaveAction,
} from "@/lib/actions/leave";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { CancelLeaveButton } from "@/components/cancel-leave-button";
import { LeaveRequestForm } from "@/components/leave-request-form";
import { formatDateIST, todayInZone } from "@/lib/time/tz";

// V-26 — the staff member's leave card on the Me tab: balances, a
// request form, and their own requests. Reads through staff.self
// actions; the service returns only the caller's rows.

const STATUS_TONE: Record<string, StatusTone> = {
  pending: "warn",
  approved: "good",
  rejected: "late",
  cancelled: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export async function MyLeaveCard() {
  const year = Number(todayInZone("Asia/Kolkata").slice(0, 4));
  const [types, mine] = await Promise.all([
    listLeaveTypesAction(),
    listMyLeaveAction({ year }),
  ]);

  return (
    <section className="mt-5 rounded-card border border-line bg-paper p-4">
      <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
        <Palmtree size={15} className="text-ink-3" />
        Leave
      </h2>

      <ul className="mt-2 divide-y divide-line">
        {mine.balances.map((balance) => (
          <li
            key={balance.leaveTypeId}
            className="flex items-baseline justify-between gap-3 py-2.5"
          >
            <span className="text-[13.5px]">
              {balance.name}
              {balance.isPaid ? "" : " · unpaid"}
            </span>
            <span className="text-[13px] text-ink-3 tabular-nums">
              {balance.annualQuota === null
                ? "Unlimited"
                : `${balance.availableDays} of ${balance.annualQuota} left`}
              {balance.pendingDays > 0 ? ` · ${balance.pendingDays} pending` : ""}
            </span>
          </li>
        ))}
      </ul>

      <details className="mt-3 border-t border-line pt-3">
        <summary className="min-h-11 cursor-pointer text-[13.5px] font-medium">
          Request leave
        </summary>
        <LeaveRequestForm types={types} />
      </details>

      {mine.requests.length > 0 ? (
        <ul className="mt-3 border-t border-line pt-1">
          {mine.requests.map((request) => (
            <li
              key={request.id}
              className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px]">
                  {request.leaveTypeName} · {request.days} day
                  {request.days === 1 ? "" : "s"}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {formatDateIST(`${request.fromDate}T12:00:00Z`)} –{" "}
                  {formatDateIST(`${request.toDate}T12:00:00Z`)}
                  {request.decisionNote ? ` · ${request.decisionNote}` : ""}
                </p>
              </div>
              <StatusBadge tone={STATUS_TONE[request.status] ?? "neutral"}>
                {STATUS_LABEL[request.status] ?? request.status}
              </StatusBadge>
              {request.status === "pending" ? (
                <CancelLeaveButton requestId={request.id} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
