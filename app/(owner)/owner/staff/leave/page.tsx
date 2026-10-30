import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import {
  listLeaveRequestsAction,
  listLeaveTypesAction,
} from "@/lib/actions/leave";
import { LeaveTypesEditor } from "@/components/leave-types-editor";
import { LeaveDecisionControls } from "@/components/leave-decision-controls";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { formatDateIST } from "@/lib/time/tz";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// V-26 — owner's leave surface: the type catalogue and the request
// queue. Decisions (approve/reject with uncovered-session flagging)
// land in V-27; this pass shows the queue and manages the types.

const STATUS_TONE: Record<string, StatusTone> = {
  pending: "warn",
  approved: "good",
  rejected: "late",
  cancelled: "neutral",
};

// Owner redesign (C2) — a decided request states its state in a
// readable word, not as the raw database value.
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export default async function StaffLeavePage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.roster");

  const [types, requests] = await Promise.all([
    listLeaveTypesAction(),
    listLeaveRequestsAction({}),
  ]);

  // The decision queue leads; decided requests are history below it.
  const pending = requests.filter((request) => request.status === "pending");
  const decided = requests.filter((request) => request.status !== "pending");

  return (
    <OwnerPage>
      <PageHeader
        title={<>Leave</>}
        purpose={<>Pending decisions first, with the affected session coverage before you
        approve. Decided requests stay below as history.</>}
      />

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
      <section className="rounded-card border border-line bg-paper p-5">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Pending approval
        </h2>
        <p className="mt-1 text-[12.5px] text-ink-3">
          {pending.length === 0
            ? "No leave request is waiting for a decision."
            : "Check the affected session coverage before deciding."}
        </p>
        {pending.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-3">No leave requests yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {pending.map((request) => (
              <li key={request.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
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
                  <LeaveDecisionControls requestId={request.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-card border border-line bg-paper p-5">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Previous decisions
        </h2>
        {decided.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-ink-3">
            No decided request yet.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {decided.map((request) => (
              <li key={request.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium">{request.staffName}</p>
                    <p className="mt-0.5 text-[12px] text-ink-3">
                      {request.leaveTypeName} · {request.days} day
                      {request.days === 1 ? "" : "s"} ·{" "}
                      {formatDateIST(`${request.fromDate}T12:00:00Z`)} –{" "}
                      {formatDateIST(`${request.toDate}T12:00:00Z`)}
                      {/* P3 (independent review) — the decided history
                          keeps WHY the leave was asked for. */}
                      {request.reason ? ` · ${request.reason}` : ""}
                    </p>
                    {request.decisionNote ? (
                      <p className="mt-0.5 text-[12px] text-ink-2">
                        Note: {request.decisionNote}
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge tone={STATUS_TONE[request.status] ?? "neutral"}>
                    {STATUS_LABEL[request.status] ?? request.status}
                  </StatusBadge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>

      <LeaveTypesEditor types={types} />
    </OwnerPage>
  );
}
