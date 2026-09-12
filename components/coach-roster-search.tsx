"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { CoachRosterRow } from "@/lib/services/coach-schedule";

// Inline client-side filter on top of the coach's roster. Search is
// non-sticky and scrolls away with the list, so it never competes
// with the bottom nav — a coach looking someone up poolside types
// their name and scrolls. A URL pattern would force a round-trip per
// keystroke on mobile, which is the wrong shape for the use case.
export function CoachRosterSearch({ roster }: { roster: CoachRosterRow[] }) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const filtered = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        m.batches.some((b) => b.toLowerCase().includes(q)),
    );
  }, [roster, deferred]);

  if (roster.length === 0) return null;

  return (
    <>
      <div className="mt-4 relative">
        <Search
          size={14}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or code"
          aria-label="Search members"
          className="w-full min-h-[44px] pl-9 pr-3 rounded-ctl bg-paper border border-line text-[16px]"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="mt-4 text-center text-[13px] text-ink-3 py-8">
          No members match &ldquo;{deferred}&rdquo;.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-paper">
          {filtered.map((m) => (
            <li key={m.memberId}>
              <Link
                href={`/coach/members/${m.memberId}`}
                className="flex items-baseline justify-between gap-3 px-3.5 py-3 transition-colors duration-150 active:bg-deck"
                data-testid="coach-roster-row"
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-medium truncate">
                    {m.name}
                    {m.isMinor ? (
                      <span className="text-[11px] text-ink-3">{" (minor)"}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3 truncate">
                    {m.code}
                    {m.batches.length > 0 ? (
                      <span className="text-ink-3"> · {m.batches.join(", ")}</span>
                    ) : null}
                  </p>
                </div>
                <span className="text-ink-3 text-[12px] flex-none">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
