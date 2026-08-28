"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, X } from "lucide-react";
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
      {/* The lane strip: a coloured surface, not a bare progress bar —
          this is the same signature element the coach today-list and (once
          built) the owner/parent screens reuse. See DESIGN.md §"the lane
          strip". */}
      <div className="sticky top-0 z-10 -mx-5 px-5 pt-3 pb-3 bg-deck/95 backdrop-blur-sm">
        <div className="rounded-card bg-water-soft px-4 py-3">
          <p className="text-[13px] text-ink-2">
            <span className="font-display font-semibold text-[15px] text-water">
              {markedCount}
            </span>{" "}
            of {rows.length} marked
          </p>
          <div className="mt-2 h-1.5 rounded-pill bg-paper overflow-hidden">
            <div
              className="h-full rounded-pill bg-water transition-[width] duration-150"
              style={{ width: `${rows.length ? (markedCount / rows.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      <ul className="mt-2 pb-8">
        {rows.map((r) => (
          <li key={r.memberId} className="border-b border-line py-2 last:border-0">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium truncate">{r.name}</p>
                <p className="text-[12px] text-ink-3">
                  {r.pct === null ? "—" : `${r.pct}% this month`}
                </p>
              </div>

              {/*
                Un-carded on purpose (U1): a bordered card + full-width
                buttons per row cost 2-3x the vertical space of a single
                line, which means more scrolling one-handed at a poolside —
                directly against the 60-second-register target.

                TOUCH TARGET: the glyph below is ~18px, deliberately smaller
                than the tap target. The button itself is h-11 w-11 (44px)
                — that's the hit box, extended by padding around the small
                glyph, not the glyph's own size. Do not "tidy" these back
                into full-width labelled buttons to make them look bigger;
                that undoes U1 and the 44px requirement is already met.
              */}
              <div className="flex gap-1.5 flex-none">
                <button
                  type="button"
                  onClick={() => mark(r.memberId, "present")}
                  aria-label="Present"
                  aria-pressed={marks[r.memberId] === "present"}
                  className={`h-11 w-11 grid place-items-center rounded-ctl border transition-colors duration-150 ${
                    marks[r.memberId] === "present"
                      ? "bg-good-soft border-good text-good"
                      : "bg-deck border-line text-ink-3"
                  }`}
                >
                  <Check size={18} strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  onClick={() => mark(r.memberId, "absent")}
                  aria-label="Absent"
                  aria-pressed={marks[r.memberId] === "absent"}
                  className={`h-11 w-11 grid place-items-center rounded-ctl border transition-colors duration-150 ${
                    marks[r.memberId] === "absent"
                      ? "bg-late-soft border-late text-late"
                      : "bg-deck border-line text-ink-3"
                  }`}
                >
                  <X size={18} strokeWidth={2.4} />
                </button>
              </div>
            </div>
            {failed[r.memberId] ? (
              <p className="mt-1 text-[12px] text-warn">
                Not saved — check connection and mark again.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
