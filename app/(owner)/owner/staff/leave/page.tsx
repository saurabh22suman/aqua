import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import {
  listLeaveRequestsAction,
  listLeaveTypesAction,
} from "@/lib/actions/leave";
import { LeaveTypesEditor } from "@/components/leave-types-editor";
import { LeaveDecisionControls } from "@/components/leave-decision-controls";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { formatDateIST } from "@/lib/time/tz";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
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
const leavePageHref = "/owner/staff/leave";

export default async function StaffLeavePage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.roster");

  // Dot SS-01 — the service caps a read at 100 rows, earliest first. Ask
  // for the actionable queue through the existing status filter so older
  // decided history can never fill the window and hide a later pending
  // request. History and the type catalogue are separate reads; any
  // failure is reported rather than rendered as empty.
  const [typesResult, pendingResult, historyResult] = await Promise.allSettled([
    listLeaveTypesAction(),
    listLeaveRequestsAction({ status: "pending" }),
    listLeaveRequestsAction({}),
  ]);
  const types = typesResult.status === "fulfilled" ? typesResult.value : null;

  const pending =
    pendingResult.status === "fulfilled"
      ? pendingResult.value.filter((request) => request.status === "pending")
      : null;
  const history =
    historyResult.status === "fulfilled" ? historyResult.value : null;
  const decided = (history ?? []).filter(
    (request) => request.status !== "pending",
  );
  // The service returns at most 100 rows; say so instead of implying the
  // list is complete.
  const historyCapped = history !== null && history.length === 100;
  const pendingCount = pending === null ? null : pending.length;
  const decidedCount = history === null ? null : decided.length;

  return (
    <OwnerPage workflow="directory">
      <PageHeader
        title={<>Leave</>}
        purpose={<>Pending decisions first, with the affected session coverage before you
        approve. Decided requests stay below as history.</>}
      />

      <nav
        aria-label="Leave sections"
        className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-medium"
      >
        <a
          href="#leave-pending"
          className="inline-flex min-h-11 items-center text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
        >
          Pending approval{pendingCount === null ? "" : ` (${pendingCount})`}
        </a>
        <a
          href="#leave-history"
          className="inline-flex min-h-11 items-center text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
        >
          Previous decisions{decidedCount === null ? "" : ` (${decidedCount})`}
        </a>
        <a
          href="#leave-types"
          className="inline-flex min-h-11 items-center text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
        >
          Leave types
        </a>
      </nav>

      <div className="mt-2 grid items-start gap-5 lg:grid-cols-2">
      <section
        id="leave-pending" tabIndex={-1} aria-labelledby="leave-pending-title"
        className="owner-work-panel"
      >
        <h2 id="leave-pending-title" className="font-display text-[16px] font-semibold text-ink">
          Pending approval
        </h2>
        <p
          className="mt-1 text-[12.5px] text-ink-3"
          role={pending === null ? "alert" : undefined}
        >
          {pending === null
            ? "Could not load pending requests. Refresh the page to try again."
            : pending.length === 0
              ? "No leave request is waiting for a decision."
              : "Check the affected session coverage before deciding."}
        </p>
        {pending === null ? <Link href="/owner/staff/leave" className="inline-flex min-h-11 items-center font-semibold text-[var(--accent-ink)]">Retry pending requests</Link> : null}
        {pending !== null && pending.length > 0 ? (
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
        ) : null}
      </section>

      <section
        id="leave-history" tabIndex={-1} aria-labelledby="leave-history-title"
        className="scroll-mt-4 rounded-card border border-line bg-paper p-5"
      >
        <h2 id="leave-history-title" className="font-display text-[16px] font-semibold text-ink">
          Previous decisions
        </h2>
        {history === null ? (
          <p role="alert" className="mt-1 text-[12.5px] text-ink-3">
            Could not load previous decisions. Refresh the page to try again.
          </p>
        ) : decided.length === 0 ? (
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
        {historyCapped ? (
          <p className="mt-2 text-[12px] text-ink-3">
            Showing the first 100 requests, earliest first. Some decisions may
            not be listed here.
          </p>
        ) : null}
      </section>
      </div>

      <div id="leave-types" className="scroll-mt-4">
        {types === null ? (
          <section
            aria-label="Leave types"
            className="mt-5 rounded-card border border-line bg-paper p-5"
          >
            <h2 className="font-display text-[16px] font-semibold">
              Leave types
            </h2>
            <p role="alert" className="mt-1 text-[12.5px] text-ink-3">
              Could not load leave types. The approval queue above still works.
            </p>
            <a
              href={leavePageHref}
              className="mt-2 inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
            >
              Retry leave types
            </a>
          </section>
        ) : (
          <LeaveTypesEditor types={types} />
        )}
      </div>
    </OwnerPage>
  );
}
