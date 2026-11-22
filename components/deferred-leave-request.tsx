"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { LeaveTypeRow } from "@/lib/services/leave";

const LeaveRequestForm = dynamic(
  () => import("./leave-request-form").then((module) => module.LeaveRequestForm),
  { loading: () => <p role="status" className="text-[13px] text-ink-3">Loading leave form…</p> },
);

export function DeferredLeaveRequest({ types }: { types: LeaveTypeRow[] }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className="mt-3 border-t border-line pt-3"
      onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
      <summary className="min-h-11 cursor-pointer text-[13.5px] font-medium">
        Request leave
      </summary>
      {/* Keep the mounted form after first opening so closing preserves drafts. */}
      {opened ? <LeaveRequestForm types={types} /> : null}
    </details>
  );
}
