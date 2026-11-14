import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import {
  listOperatorAccountsAction,
  listOperatorSessionsAction,
} from "@/lib/actions/platform-operators-read";
import {
  OpsEmptyState,
  OpsPage,
  OpsPageHeader,
  OpsSection,
} from "@/components/ops/ops-primitives";
import { OperatorList } from "./operator-list";

export const dynamic = "force-dynamic";

/**
 * The viewer's refusal.
 *
 * It renders NO operator material — no account, no session, no count.
 * The console shell around it already says who is signed in; that is
 * the viewer's own identity and nothing more.
 */
function OperatorRefusal() {
  return (
    <OpsPage>
      <OpsPageHeader
        title="Operators"
        lede="This console is for administrators."
      />
      <OpsEmptyState
        className="mt-6"
        title="Read-only access."
        body="Your platform account can browse the console, not administer operator accounts or sessions."
      />
    </OpsPage>
  );
}

export default async function OpsOperatorsPage() {
  const status = await platformAuthStatusAction();
  if (status.kind === "not_found" || status.kind === "expired") redirect("/ops/login");
  if (status.kind === "unauthenticated") redirect("/ops/verify");
  if (status.role !== "admin") return <OperatorRefusal />;

  const accounts = await listOperatorAccountsAction(null, new FormData());
  if (!accounts.ok) redirect("/ops/login");

  const operatorIds = accounts.value.rows.map((row) => row.id);
  const sessions = await listOperatorSessionsAction(null, sessionsForm(operatorIds));
  if (!sessions.ok) redirect("/ops/login");

  // The session window is bounded ACROSS the listed operators. The page
  // says so, rather than letting a card imply that its operator has no
  // other sessions.
  const bounded =
    accounts.value.total > accounts.value.rows.length ||
    sessions.value.total > sessions.value.rows.length;

  return (
    <OpsPage>
      <OpsPageHeader
        title="Operators"
        lede="Who can administer this console, and the state of their sessions."
        meta={
          bounded
            ? `Showing ${accounts.value.rows.length} of ${accounts.value.total} accounts and ${sessions.value.rows.length} of ${sessions.value.total} sessions of the listed accounts (session limit ${sessions.value.limit}).`
            : undefined
        }
      />

      <OpsSection
        className="mt-6"
        title="Operator accounts"
        subtitle="Review console access and sessions. Every maintenance action needs a reason."
      >
        {accounts.value.rows.length === 0 ? (
          <OpsEmptyState
            title="No operator accounts."
            body="An operator account is created outside this console."
          />
        ) : (
          <OperatorList
            actorId={status.userId}
            operators={accounts.value.rows}
            sessions={sessions.value.rows}
            sessionCounts={sessions.value.countsByOperator}
          />
        )}
      </OpsSection>
    </OpsPage>
  );
}

/** The bounded set of operators whose sessions are read. */
function sessionsForm(operatorIds: string[]): FormData {
  const formData = new FormData();
  for (const id of operatorIds) formData.append("operatorId", id);
  return formData;
}
