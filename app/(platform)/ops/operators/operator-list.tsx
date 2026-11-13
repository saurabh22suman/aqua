import {
  OpsCard,
  OpsEmptyState,
  OpsPanel,
  OpsSection,
} from "@/components/ops/ops-primitives";
import { OpsStatusPill } from "@/components/ops/ops-display";
import type {
  OperatorAccountRow,
  OperatorSessionRow,
} from "@/db/platform-operators-read";
import {
  ChangeAccountStatusForm,
  ChangeRoleForm,
  RevokeAllSessionsForm,
  RevokeSessionForm,
} from "./operator-forms";
import { operatorTime, shortOperatorId } from "./operator-format";

export function OperatorList({
  actorId,
  operators,
  sessions,
  sessionCounts,
}: {
  /** The signed-in administrator's own operator id. */
  actorId: string;
  operators: OperatorAccountRow[];
  sessions: OperatorSessionRow[];
  /** The true session count per operator. */
  sessionCounts: Record<string, number>;
}) {
  return (
    <div className="space-y-4">
      {operators.map((operator) => {
        const own = sessions.filter((session) => session.operatorId === operator.id);
        const liveShown = own.filter((session) => session.state === "active").length;
        const trueCount = sessionCounts[operator.id] ?? 0;
        const isOwn = operator.id === actorId;
        return (
          <OpsCard key={operator.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink">{operator.name}</p>
                <p className="mt-0.5 text-[13px] text-ink-2">{operator.email}</p>
                {isOwn ? (
                  <p className="mt-0.5 text-[12px] text-ink-3">This is your own account.</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <OpsStatusPill tone={operator.role === "admin" ? "water" : "neutral"}>
                  {operator.role === "admin" ? "Administrator" : "Viewer"}
                </OpsStatusPill>
                <OpsStatusPill tone={operator.status === "active" ? "good" : "warn"}>
                  {operator.status === "active" ? "Active" : "Suspended"}
                </OpsStatusPill>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] md:grid-cols-4">
              <div>
                <dt className="text-ink-3">Last sign-in</dt>
                <dd className="text-ink-2">
                  {operator.lastLoginAt ? operatorTime(operator.lastLoginAt) : "Never"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Created</dt>
                <dd className="text-ink-2">{operatorTime(operator.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Sessions</dt>
                <dd className="text-ink-2">
                  {trueCount} total{own.length < trueCount ? `, ${own.length} shown` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Live (shown)</dt>
                <dd className="text-ink-2">{liveShown}</dd>
              </div>
            </dl>

            <OpsSection
              className="mt-4"
              title="Sessions"
              subtitle="A session ends when it expires or when an administrator ends it."
            >
              {own.length === 0 ? (
                <OpsEmptyState title="No sessions." body="This operator has no session open." />
              ) : (
                <ul className="space-y-3">
                  {own.map((session) => (
                    <li key={session.id}>
                      <OpsPanel className="p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[13px] text-ink">
                            <span title={session.id}>{shortOperatorId(session.id)}</span>
                          </p>
                          <OpsStatusPill tone={session.state === "active" ? "good" : "neutral"}>
                            {session.state === "active" ? "Live" : "Expired"}
                          </OpsStatusPill>
                        </div>
                        <p className="mt-1 text-[12px] text-ink-3">
                          Signed in {operatorTime(session.createdAt)} · last seen{" "}
                          {operatorTime(session.lastSeenAt)} · expires{" "}
                          {operatorTime(session.expiresAt)} · second factor{" "}
                          {session.secondFactorPassed ? "completed" : "not completed"}
                        </p>
                        {session.state === "active" ? (
                          <RevokeSessionForm
                            sessionId={session.id}
                            isOwnSession={isOwn}
                            className="mt-3"
                          />
                        ) : null}
                      </OpsPanel>
                    </li>
                  ))}
                </ul>
              )}
            </OpsSection>

            <OpsSection
              className="mt-4"
              title="Maintenance"
              subtitle="Every change is recorded with a reason. Changing the role or the status ends the operator's open sessions."
            >
              {isOwn ? (
                <p className="text-[13px] text-ink-2">
                  You cannot change your own role or status — another administrator has to do it.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <ChangeRoleForm
                    operatorId={operator.id}
                    currentRole={operator.role}
                  />
                  <ChangeAccountStatusForm
                    operatorId={operator.id}
                    currentStatus={operator.status}
                  />
                </div>
              )}
              <RevokeAllSessionsForm operatorId={operator.id} isOwnOperator={isOwn} className="mt-4" />
            </OpsSection>
          </OpsCard>
        );
      })}
    </div>
  );
}
