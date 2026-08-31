"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { transitionMemberStatusAction } from "@/lib/actions/people";
import { MEMBER_STATUS_LABELS, MEMBER_STATUS_TRANSITIONS } from "@/lib/member-status-graph";
import type { MemberStatus } from "@/db/schema/people";

export function MemberStatusPanel({
  memberId,
  status,
}: {
  memberId: string;
  status: MemberStatus;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<MemberStatus | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options = MEMBER_STATUS_TRANSITIONS[status] ?? [];

  async function confirm() {
    if (!target) return;
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await transitionMemberStatusAction({ memberId, toStatus: target, reason: reason.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTarget(null);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (options.length === 0) return null;

  return (
    <div className="mt-3">
      {target ? (
        <div className="rounded-card border border-line bg-paper p-3.5 space-y-2.5">
          <p className="text-[13px] font-medium">
            Move to {MEMBER_STATUS_LABELS[target]} — why?
          </p>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
            data-testid="status-reason"
            autoFocus
          />
          {error ? <p className="text-[12px] text-late">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="rounded-ctl bg-mango px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50"
              data-testid="confirm-status-change"
            >
              {busy ? "Saving…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => {
                setTarget(null);
                setError(null);
              }}
              className="rounded-ctl border border-line px-3.5 py-2 text-[13px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTarget(option)}
              className="rounded-ctl border border-line bg-paper px-3 py-1.5 text-[12.5px]"
              data-testid={`status-to-${option}`}
            >
              Move to {MEMBER_STATUS_LABELS[option]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
