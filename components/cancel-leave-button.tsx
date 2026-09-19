"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelLeaveRequestAction } from "@/lib/actions/leave";

// V-26 — cancel a pending leave request (own only; the service
// enforces both the ownership and the pending state).

export function CancelLeaveButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await cancelLeaveRequestAction(requestId);
          router.refresh();
        })
      }
      className="min-h-11 rounded-pill border border-line bg-paper px-3 text-[12.5px] text-ink-2 disabled:opacity-50"
    >
      Cancel
    </button>
  );
}
