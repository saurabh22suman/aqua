import { requireOwner } from "@/lib/auth/surface-guard";
import { requirePermission } from "@/lib/auth/permission";
import {
  listLeaveRequestsAction,
  listLeaveTypesAction,
} from "@/lib/actions/leave";
import { BackLink } from "@/components/ui/BackLink";
import { LeaveTypesEditor } from "@/components/leave-types-editor";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { formatDateIST } from "@/lib/time/tz";

// V-26 — owner's leave surface: the type catalogue and the request
// queue. Decisions (approve/reject with uncovered-session flagging)
// land in V-27; this pass shows the queue and manages the types.

const STATUS_TONE: Record<string, StatusTone> = {
  pending: "warn",
  approved: "good",
  rejected: "late",
  cancelled: "neutral",
};

export default async function StaffLeavePage() {
  const ctx = await requireOwner();
  requirePermission(ctx, "staff.roster");

  const [types, requests] = await Promise.all([
    listLeaveTypesAction(),
    listLeaveRequestsAction({}),
  ]);

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/staff" label="Staff" />
      <h1 className="mt-2 font-display text-[19px] font-semibold">Leave</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Requests from staff, and the types they draw from.
      </p>

      <section className="mt-5">
        <h2 className="font-display text-[15px] font-semibold">Requests</h2>
        {requests.length === 0 ? (
          <p className="mt-2 rounded-card border border-line bg-paper px-4 py-6 text-center text-[13px] text-ink-3">
            No leave requests yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
            {requests.map((request) => (
              <li key={request.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium">{request.staffName}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {request.leaveTypeName} · {request.days} day
                    {request.days === 1 ? "" : "s"} ·{" "}
                    {formatDateIST(`${request.fromDate}T12:00:00Z`)} –{" "}
                    {formatDateIST(`${request.toDate}T12:00:00Z`)}
                    {request.reason ? ` · ${request.reason}` : ""}
                  </p>
                </div>
                <StatusBadge tone={STATUS_TONE[request.status] ?? "neutral"}>
                  {request.status}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <LeaveTypesEditor types={types} />
    </main>
  );
}
