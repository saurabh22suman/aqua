import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { CancelLeaveButton } from "@/components/cancel-leave-button";
import { DeferredLeaveRequest } from "@/components/deferred-leave-request";
import { STAFF_CARD } from "@/components/staff-ui/staff-page";
import { formatDateIST } from "@/lib/time/tz";
import type {
  LeaveBalanceRow,
  LeaveRequestRow,
  LeaveTypeRow,
} from "@/lib/services/leave";

// V-26 — the staff member's leave card on the Me tab: balances, a
// request form, and their own requests. The page reads through
// staff.self actions (listLeaveTypesAction, listMyLeaveAction) and
// passes the rows in; the service returns only the caller's rows. A
// pure component, so page tests can render it without a data layer.

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

/**
 * The unpaid marker exists to say something the leave type's own name
 * does not. A type whose name already says "unpaid" (in any case) must
 * not be told twice — "Unpaid · unpaid" says it twice.
 *
 * The stored values and the permissions are untouched: only the printed
 * text changes.
 */
function unpaidMarker(name: string, isPaid: boolean): string {
  if (isPaid) return "";
  if (/unpaid/i.test(name)) return "";
  return " · unpaid";
}

export function MyLeaveCard({
  types,
  balances,
  requests,
}: {
  types: LeaveTypeRow[];
  balances: LeaveBalanceRow[];
  requests: LeaveRequestRow[];
}) {
  return (
    <section className={`mt-4 p-4 ${STAFF_CARD}`}>
      <h2 className="flex items-center gap-2 text-[15px] font-medium text-ink">
        <OwnerIcon name="calendar" size={16} className="text-ink-3" />
        Leave
      </h2>

      <ul className="mt-2 divide-y divide-line">
        {balances.map((balance) => (
          <li
            key={balance.leaveTypeId}
            className="flex items-baseline justify-between gap-3 py-2.5"
          >
            <span className="text-[13.5px]">
              {balance.name}
              {unpaidMarker(balance.name, balance.isPaid)}
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

      <DeferredLeaveRequest types={types} />

      {requests.length > 0 ? (
        <ul className="mt-3 border-t border-line pt-1">
          {requests.map((request) => (
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
