"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  selfCheckInAction,
  selfCheckOutAction,
} from "@/lib/actions/staff-attendance";

// V-24 — the staff member's own check-in/out buttons on the Me tab.
// Both calls ride staff.self and the service resolves the caller's own
// staff row; there is no way to act on someone else from here.

export function StaffCheckInControls({
  checkedIn,
  checkedOut,
}: {
  checkedIn: boolean;
  checkedOut: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      setError(result.ok ? null : (result.error ?? "Something went wrong."));
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="mt-3">
      {!checkedIn ? (
        <Button
          variant="primary"
          size="md"
          disabled={pending}
          onClick={() => run(() => selfCheckInAction({ method: "self_app" }))}
        >
          Check in
        </Button>
      ) : !checkedOut ? (
        <Button
          variant="primary"
          size="md"
          disabled={pending}
          onClick={() => run(() => selfCheckOutAction())}
        >
          Check out
        </Button>
      ) : (
        <p className="text-[13px] text-ink-3">Done for today.</p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-ink-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}
