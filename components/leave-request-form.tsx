"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { requestLeaveAction } from "@/lib/actions/leave";
import type { LeaveTypeRow } from "@/lib/services/leave";

// V-26 — the staff member's own leave request form. Dates come from
// the masked DateField (day-first, ISO out); the service checks the
// remaining balance, so an over-quota request is refused with the
// number left, not silently accepted.

export function LeaveRequestForm({ types }: { types: LeaveTypeRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [leaveTypeId, setLeaveTypeId] = useState(types[0]?.id ?? "");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (types.length === 0) {
    return (
      <p className="mt-2 text-[13px] text-ink-3">
        No leave types are set up yet. Ask the owner to add one.
      </p>
    );
  }

  const ready =
    leaveTypeId.length > 0 && fromDate.length === 10 && toDate.length === 10;

  return (
    <div className="mt-3 grid gap-3">
      <label className="block">
        <span className="mb-1 block text-[11px] text-ink-3">Type</span>
        <select
          value={leaveTypeId}
          onChange={(e) => setLeaveTypeId(e.target.value)}
          className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
        >
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
              {type.annualQuota === null ? "" : ` (${type.annualQuota}/year)`}
              {type.isPaid ? "" : " · unpaid"}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block min-w-0">
          <span className="mb-1 block text-[11px] text-ink-3">From</span>
          <DateField value={fromDate} onChange={setFromDate} />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[11px] text-ink-3">To</span>
          <DateField value={toDate} onChange={setToDate} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] text-ink-3">
          Reason (optional)
        </span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
        />
      </label>
      <Button
        variant="primary"
        disabled={pending || !ready}
        onClick={() =>
          startTransition(async () => {
            const result = await requestLeaveAction({
              leaveTypeId,
              fromDate,
              toDate,
              reason: reason.trim() === "" ? null : reason.trim(),
            });
            if (!result.ok) {
              setError(result.error);
              setMessage(null);
              return;
            }
            setError(null);
            setMessage(
              `Requested ${result.days} day${result.days === 1 ? "" : "s"} — waiting for approval.`,
            );
            setFromDate("");
            setToDate("");
            setReason("");
            router.refresh();
          })
        }
      >
        Request leave
      </Button>
      {message ? (
        <p className="text-[13px] text-ink-2">{message}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12.5px] text-ink-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}
