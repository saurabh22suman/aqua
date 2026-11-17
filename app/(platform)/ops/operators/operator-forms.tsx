"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  revokeAllOperatorSessionsAction,
  revokeOperatorSessionAction,
  setOperatorRoleAction,
  setOperatorStatusAction,
} from "@/lib/actions/platform-operators-write";

type ActionOutcome = {
  kind: "applied" | "noop" | "refused" | "error";
  revokedSessions?: number;
  expiredSessions?: number;
  reason?: string;
  error?: string;
};

const REFUSAL_TEXT: Record<string, string> = {
  not_admin: "Your account may not do that.",
  self_mutation: "You cannot change your own role or status.",
  last_admin: "That would leave the platform with no active administrator.",
  unknown_operator: "That operator account no longer exists.",
  invalid_reason: "Enter a reason between 1 and 500 characters.",
};

const NOOP_TEXT: Record<string, string> = {
  no_sessions: "There was no session to end.",
  no_live_sessions: "There was no live session to end.",
  already_in_state: "It was already in that state.",
  unknown_session: "That session no longer exists.",
  expired_session: "That session had already expired.",
};

function asOutcome(state: unknown): ActionOutcome | null {
  if (!state || typeof state !== "object") return null;
  const kind = (state as { kind?: unknown }).kind;
  if (
    kind !== "applied" &&
    kind !== "noop" &&
    kind !== "refused" &&
    kind !== "error"
  ) {
    return null;
  }
  return state as ActionOutcome;
}

function outcomeText(state: unknown): { tone: string; text: string } | null {
  const outcome = asOutcome(state);
  if (!outcome) return null;
  if (outcome.kind === "error") {
    return { tone: "late", text: outcome.error ?? "The request failed." };
  }
  if (outcome.kind === "applied") {
    const parts: string[] = [];
    if ((outcome.revokedSessions ?? 0) > 0) {
      parts.push(`${outcome.revokedSessions} session(s) ended`);
    }
    if ((outcome.expiredSessions ?? 0) > 0) {
      parts.push(`${outcome.expiredSessions} had already expired and were left alone`);
    }
    return { tone: "good", text: parts.length > 0 ? `Done. ${parts.join(", ")}.` : "Done." };
  }
  if (outcome.kind === "noop") {
    const why = NOOP_TEXT[outcome.reason ?? ""] ?? "";
    return { tone: "warn", text: `Nothing changed. ${why}`.trim() };
  }
  const why = REFUSAL_TEXT[outcome.reason ?? ""] ?? "";
  return { tone: "late", text: `Refused. ${why}`.trim() };
}

function Outcome({ state }: { state: unknown }) {
  const outcome = outcomeText(state);
  if (!outcome) return null;
  return (
    <p
      role="status"
      data-testid="operator-action-outcome"
      className="mt-2 text-[12px] text-ink-2"
    >
      {outcome.text}
    </p>
  );
}

/**
 * A destructive control that takes two steps.
 *
 * The first click arms it and the second carries it out; the reason is
 * typed before either. The armed state lives in this component, so it
 * survives the submission.
 */
function ConfirmSubmit({
  label,
  confirmLabel,
  pending,
  result,
}: {
  label: string;
  confirmLabel: string;
  pending: boolean;
  result: unknown;
}) {
  const [armedAt, setArmedAt] = useState<{ result: unknown } | null>(null);
  const armed = armedAt !== null && armedAt.result === result;
  if (!armed) {
    return (
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setArmedAt({ result })}
      >
        {label}
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        {confirmLabel}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => setArmedAt(null)}>
        Cancel
      </Button>
    </span>
  );
}

function ReasonField({ label }: { label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink-2">{label}</span>
      <Input
        name="reason"
        required
        maxLength={500}
        placeholder="Why is this happening?"
        autoComplete="off"
      />
    </label>
  );
}

function SignOutWarning() {
  return (
    <p className="mt-2 text-[12px] text-ink-3">
      This ends the session you are signed in with — you will be signed out when it ends.
    </p>
  );
}

export function RevokeSessionForm({
  sessionId,
  isOwnSession,
  className,
}: {
  sessionId: string;
  isOwnSession: boolean;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(
    revokeOperatorSessionAction,
    null,
  );
  return (
    <form action={formAction} method="post" suppressHydrationWarning className={className}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <ReasonField label="Reason" />
      {isOwnSession ? <SignOutWarning /> : null}
      <div className="mt-2">
        <ConfirmSubmit
        result={state}
          label="Revoke session"
          confirmLabel="Yes, end this session"
          pending={pending}
        />
      </div>
      <Outcome state={state} />
    </form>
  );
}

export function RevokeAllSessionsForm({
  operatorId,
  isOwnOperator,
  className,
}: {
  operatorId: string;
  isOwnOperator: boolean;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(
    revokeAllOperatorSessionsAction,
    null,
  );
  return (
    <form action={formAction} method="post" suppressHydrationWarning className={className}>
      <input type="hidden" name="operatorId" value={operatorId} />
      <ReasonField label="Reason" />
      {isOwnOperator ? <SignOutWarning /> : null}
      <div className="mt-2">
        <ConfirmSubmit
        result={state}
          label="Revoke all sessions"
          confirmLabel="Yes, end every session"
          pending={pending}
        />
      </div>
      <Outcome state={state} />
    </form>
  );
}

export function ChangeRoleForm({
  operatorId,
  currentRole,
  className,
}: {
  operatorId: string;
  currentRole: "admin" | "viewer";
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(setOperatorRoleAction, null);
  return (
    <form action={formAction} method="post" suppressHydrationWarning className={className}>
      <input type="hidden" name="operatorId" value={operatorId} />
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-ink-2">Role</span>
        <Select key={currentRole} name="role" defaultValue={currentRole}>
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </Select>
      </label>
      <div className="mt-2">
        <ReasonField label="Reason" />
      </div>
      <div className="mt-2">
        <ConfirmSubmit
        result={state}
          label="Change role"
          confirmLabel="Yes, change the role"
          pending={pending}
        />
      </div>
      <Outcome state={state} />
    </form>
  );
}

export function ChangeAccountStatusForm({
  operatorId,
  currentStatus,
  className,
}: {
  operatorId: string;
  currentStatus: "active" | "suspended";
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(
    setOperatorStatusAction,
    null,
  );
  return (
    <form action={formAction} method="post" suppressHydrationWarning className={className}>
      <input type="hidden" name="operatorId" value={operatorId} />
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-ink-2">Status</span>
        <Select key={currentStatus} name="status" defaultValue={currentStatus}>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
      </label>
      <div className="mt-2">
        <ReasonField label="Reason" />
      </div>
      <div className="mt-2">
        <ConfirmSubmit
        result={state}
          label="Change status"
          confirmLabel="Yes, change the status"
          pending={pending}
        />
      </div>
      <Outcome state={state} />
    </form>
  );
}
