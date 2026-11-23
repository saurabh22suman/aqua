"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { selfCheckInAction } from "@/lib/actions/staff-attendance";

// V-25 — the one tap after the scan. Calls the V-24 self check-in
// with method self_qr, so the attendance row and its audit entry are
// identical to the in-app path; only `method` differs.

export function PremisesCheckInButton({
  alreadyCheckedIn,
}: {
  alreadyCheckedIn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const checkingIn = useRef(false);

  if (done || alreadyCheckedIn) {
    return (
      <p role="status" className="mt-4 flex items-center gap-2 rounded-ctl border border-line bg-paper p-3 text-[14px] font-medium text-ink">
        <CheckCircle2 size={18} aria-hidden="true" className="shrink-0 text-ink-3" />
        {done ? "Checked in. Have a good shift." : "You are checked in for today."}
      </p>
    );
  }

  function checkIn() {
    if (checkingIn.current) return;
    checkingIn.current = true;
    setError(null);
    setUncertain(false);
    startTransition(async () => {
      try {
        const result = await selfCheckInAction({ method: "self_qr" });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setDone(true);
        router.refresh();
      } catch {
        setError("Could not confirm your check-in. Check today’s status when your connection returns.");
        setUncertain(true);
      } finally {
        checkingIn.current = false;
      }
    });
  }

  return (
    <div className="mt-4" aria-busy={pending}>
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={checkIn}
      >
        {pending ? "Checking in…" : "Check in"}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-ink-2">
          {error}
        </p>
      ) : null}
      {uncertain ? <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => router.refresh()}>Check today’s status</Button> : null}
    </div>
  );
}
