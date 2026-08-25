"use client";

import { useMemo, useState, useTransition } from "react";
import { markAttendanceSessionAction } from "@/lib/actions/coach";
import type { RosterRow } from "@/lib/actions/coach";

type Mark = "present" | "absent";

export function RegisterBoard({
  sessionId,
  rows,
}: {
  sessionId: string;
  rows: RosterRow[];
}) {
  const [marks, setMarks] = useState<Record<string, Mark | "late">>(() =>
    Object.fromEntries(
      rows.filter((r) => r.status).map((r) => [r.memberId, r.status as Mark]),
    ),
  );
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  const markedCount = useMemo(
    () => Object.values(marks).filter(Boolean).length,
    [marks],
  );

  function mark(memberId: string, next: Mark) {
    const clientId = crypto.randomUUID();
    setMarks((m) => ({ ...m, [memberId]: next }));
    setFailed((f) => ({ ...f, [memberId]: false }));

    startTransition(async () => {
      const res = await markAttendanceSessionAction({
        sessionId,
        memberId,
        status: next,
        clientId,
      });
      if (!res.ok) setFailed((f) => ({ ...f, [memberId]: true }));
    });
  }

  return (
    <div>
      <div className="sticky top-0 z-10 bg-deck/95 backdrop-blur-sm py-3 -mx-5 px-5">
        <p className="text-[13px] text-ink-2">
          <span className="font-display font-semibold text-[15px] text-ink">
            {markedCount}
          </span>{" "}
          of {rows.length} marked
        </p>
        <div className="mt-2 h-1.5 rounded-pill bg-line overflow-hidden">
          <div
            className="h-full rounded-pill bg-water transition-[width] duration-150"
            style={{ width: `${rows.length ? (markedCount / rows.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      <ul className="mt-4 space-y-3 pb-8">
        {rows.map((r) => (
          <li key={r.memberId} className="bg-paper rounded-card border border-line p-3">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[14px] font-medium">{r.name}</span>
              <span className="text-[12px] text-ink-3">
                {r.pct === null ? "—" : `${r.pct}% this month`}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => mark(r.memberId, "present")}
                className={`h-11 flex-1 rounded-ctl text-[14px] font-medium border transition-colors duration-150 ${
                  marks[r.memberId] === "present"
                    ? "bg-good-soft border-good text-good"
                    : "bg-deck border-line text-ink-2"
                }`}
              >
                Present
              </button>
              <button
                onClick={() => mark(r.memberId, "absent")}
                className={`h-11 flex-1 rounded-ctl text-[14px] font-medium border transition-colors duration-150 ${
                  marks[r.memberId] === "absent"
                    ? "bg-late-soft border-late text-late"
                    : "bg-deck border-line text-ink-2"
                }`}
              >
                Absent
              </button>
            </div>
            {failed[r.memberId] ? (
              <p className="mt-2 text-[12px] text-warn">
                Not saved — check connection and mark again.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
