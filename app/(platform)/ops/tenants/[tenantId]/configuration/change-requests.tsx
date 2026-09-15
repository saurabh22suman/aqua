"use client";

import { useActionState } from "react";
import { resolveConfigChangeRequestAction } from "@/lib/actions/platform-config-requests";

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

export type ChangeRequestItem = {
  id: string;
  key: string;
  requestedValue: string;
  note: string | null;
  status: "requested" | "resolved" | "declined";
  resolutionNote: string | null;
  createdAt: string;
};

function RequestForm({ request }: { request: ChangeRequestItem }) {
  const [state, formAction, isPending] = useActionState(
    resolveConfigChangeRequestAction,
    { ok: false, error: "" },
  );

  return (
    <form
      action={formAction}
      method="post"
      suppressHydrationWarning
      className="border-b border-line last:border-b-0 px-4 py-3"
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          name="resolutionNote"
          placeholder="Resolution note (optional)"
          className="grow min-w-[14rem] rounded-ctl border border-line bg-paper px-3 py-1.5 text-[13px] text-ink focus:border-[var(--accent)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        />
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <input
            type="checkbox"
            name="applyValue"
            defaultChecked
            className="h-4 w-4"
          />
          Apply on resolve
        </label>
        <button
          type="submit"
          name="status"
          value="resolved"
          disabled={isPending}
          className="rounded-pill px-4 py-1.5 text-[12px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
        >
          Resolve
        </button>
        <button
          type="submit"
          name="status"
          value="declined"
          disabled={isPending}
          className="rounded-pill border border-line px-4 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink disabled:opacity-50"
        >
          Decline
        </button>
      </div>
      {!state.ok && state.error ? (
        <p role="alert" className="mt-2 text-[12px] text-ink-2">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function ChangeRequests({ requests }: { requests: ChangeRequestItem[] }) {
  if (requests.length === 0) {
    return (
      <p className="mt-2 rounded-card bg-paper border border-line px-4 py-3 text-[13px] text-ink-3">
        No change requests from this tenant.
      </p>
    );
  }

  const pending = requests.filter((r) => r.status === "requested");
  const decided = requests.filter((r) => r.status !== "requested");

  return (
    <div className="mt-2 space-y-3">
      {pending.length > 0 ? (
        <div className="rounded-card bg-paper border border-line overflow-hidden">
          {pending.map((request) => (
            <RequestForm key={request.id} request={request} />
          ))}
        </div>
      ) : (
        <p className="rounded-card bg-paper border border-line px-4 py-3 text-[13px] text-ink-3">
          No pending requests.
        </p>
      )}

      {decided.length > 0 ? (
        <div className="rounded-card bg-paper border border-line overflow-hidden">
          {decided.map((request) => (
            <div
              key={request.id}
              className="border-b border-line last:border-b-0 px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[12px] text-ink-2">
                  {request.key}
                </span>
                <span className="rounded-pill bg-deck px-2 py-0.5 text-[11px] text-ink-3">
                  {request.status}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-ink-3">
                Asked for {request.requestedValue}
                {request.resolutionNote ? ` — ${request.resolutionNote}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
