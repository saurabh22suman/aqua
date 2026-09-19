"use client";

import { useState, useTransition } from "react";
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

  if (done || alreadyCheckedIn) {
    return (
      <p className="mt-4 flex items-center gap-2 text-[14px] font-medium text-ink-2">
        <CheckCircle2 size={18} className="text-ink-3" />
        {done ? "Checked in. Have a good shift." : "You are checked in for today."}
      </p>
    );
  }

  return (
    <div className="mt-4">
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await selfCheckInAction({ method: "self_qr" });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setDone(true);
            router.refresh();
          })
        }
      >
        Check in
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-ink-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}
