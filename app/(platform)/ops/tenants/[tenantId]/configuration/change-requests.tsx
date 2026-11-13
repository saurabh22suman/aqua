"use client";

import { useActionState } from "react";
import { resolveConfigChangeRequestAction } from "@/lib/actions/platform-config-requests";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import {
  OpsCardFlush,
  OpsEmptyState,
} from "@/components/ops/ops-primitives";
import {
  OpsStatusPill,
  OpsWriteGate,
} from "@/components/ops/ops-display";

// Repo convention: Intl.DateTimeFormat with an explicit IST zone, never
// a hand-rolled toLocaleString (tests/mobile/date-display-sweep.test.ts).
const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

// O-07 — ops resolution of owner change requests. Each pending request
// is its own form; the two submit buttons carry the decision in the
// `status` field.
//
// Ops redesign (28 October 2026): the decisions use the SHARED
// controls, and the write permission is resolved on the server from
// the session role — a viewer reads the request and the reason it
// cannot be decided, never a live-looking decision control.
export type ChangeRequestItem = {
  id: string;
  key: string;
  requestedValue: string;
  note: string | null;
  status: "requested" | "resolved" | "declined";
  resolutionNote: string | null;
  createdAt: string;
};

const STATUS_TONE = {
  requested: "warn",
  resolved: "good",
  declined: "late",
} as const;

function RequestForm({
  request,
  canWrite,
}: {
  request: ChangeRequestItem;
  canWrite: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    resolveConfigChangeRequestAction,
    { ok: false, error: "" },
  );

  return (
    <form
      action={formAction}
      method="post"
      suppressHydrationWarning
      className="border-b border-line px-4 py-3 last:border-b-0"
    >
      <input type="hidden" name="requestId" value={request.id} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[13px] text-ink">{request.key}</span>
        <span className="text-[12px] text-ink-3">
          requested {DATETIME_FMT.format(new Date(request.createdAt))} IST
        </span>
      </div>
      <p className="mt-1 text-[13px] text-ink">
        Requested value:{" "}
        <span className="font-medium">{request.requestedValue}</span>
      </p>
      {request.note ? (
        <p className="mt-0.5 text-[12px] text-ink-3">Note: {request.note}</p>
      ) : null}
      <OpsWriteGate
        canWrite={canWrite}
        note={
          <>
            Read-only: this account can browse, not change, platform data. An
            administrator decides this request.
          </>
        }
      >
        <div className="mt-3 space-y-3">
          {/* A VISIBLE, ASSOCIATED label. The placeholder alone left
              the control unnamed to a screen reader, and the note is
              the part of the decision an operator has to read back. */}
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">
              Resolution note (optional)
            </span>
            <Input
              name="resolutionNote"
              placeholder="What changed, and why"
              className="min-w-[14rem]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Checkbox name="applyValue" defaultChecked>
              Apply on resolve
            </Checkbox>
            <Button
              type="submit"
              name="status"
              value="resolved"
              variant="primary"
              size="sm"
              disabled={isPending}
            >
              Resolve
            </Button>
            <Button
              type="submit"
              name="status"
              value="declined"
              variant="secondary"
              size="sm"
              disabled={isPending}
            >
              Decline
            </Button>
          </div>
        </div>
      </OpsWriteGate>
      {!state.ok && state.error ? (
        <p role="alert" className="mt-2 text-[12px] text-ink-2">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function ChangeRequests({
  requests,
  canWrite,
}: {
  requests: ChangeRequestItem[];
  /** Resolved on the server from the session role. */
  canWrite: boolean;
}) {
  if (requests.length === 0) {
    return (
      <OpsEmptyState
        className="mt-2"
        title="No change requests from this tenant."
        body="An owner asks for a configuration change from their own workspace; it lands here for a decision."
      />
    );
  }

  const pending = requests.filter((r) => r.status === "requested");
  const decided = requests.filter((r) => r.status !== "requested");

  return (
    <div className="mt-2 space-y-3">
      {pending.length > 0 ? (
        <OpsCardFlush>
          {pending.map((request) => (
            <RequestForm
              key={request.id}
              request={request}
              canWrite={canWrite}
            />
          ))}
        </OpsCardFlush>
      ) : (
        <OpsEmptyState
          title="No pending requests."
          body="Every change request from this tenant has been decided."
        />
      )}

      {decided.length > 0 ? (
        <OpsCardFlush>
          {decided.map((request) => (
            <div
              key={request.id}
              className="border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[12px] text-ink-2">
                  {request.key}
                </span>
                <OpsStatusPill tone={STATUS_TONE[request.status]}>
                  {request.status}
                </OpsStatusPill>
              </div>
              <p className="mt-1 text-[12px] text-ink-3">
                Asked for {request.requestedValue}
                {request.resolutionNote ? ` — ${request.resolutionNote}` : ""}
              </p>
            </div>
          ))}
        </OpsCardFlush>
      ) : null}
    </div>
  );
}
