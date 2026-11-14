"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { PersonAvatar } from "@/components/avatar";
import { Input } from "@/components/ui/Input";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { STAFF_CARD } from "@/components/staff-ui/staff-page";
import type { CoachRosterRow } from "@/lib/services/coach-schedule";

// Inline client-side filter on top of the coach's roster. Search is
// non-sticky and scrolls away with the list, so it never competes
// with the bottom nav — a coach looking someone up poolside types
// their name and scrolls. A URL pattern would force a round-trip per
// keystroke on mobile, which is the wrong shape for the use case.
export function CoachRosterSearch({
  roster,
  memberNouns,
}: {
  roster: CoachRosterRow[];
  /** The tenant-resolved plural noun, so no copy is hardcoded. */
  memberNouns?: string;
}) {
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
      <div className="relative mt-4">
        <OwnerIcon
          name="search"
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, code or batch"
          aria-label={memberNouns ? `Search ${memberNouns}` : "Search roster"}
          className="pl-11"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="mt-4 py-8 text-center text-[13px] text-ink-3">
          {memberNouns
            ? `No ${memberNouns} match “${deferred}”.`
            : `No matches for “${deferred}”.`}
        </p>
      ) : (
        <ul className={`mt-3 divide-y divide-line ${STAFF_CARD}`}>
          {filtered.map((m) => (
            <li key={m.memberId}>
              <Link
                href={`/coach/members/${m.memberId}`}
                className="flex items-center gap-3 px-3.5 py-3 transition-colors duration-150 hover:bg-deck/50 active:bg-deck"
                data-testid="coach-roster-row"
              >
                {/* The avatar draws the member's displayed name (the
                    name beside it), and keeps the stable id as identity
                    metadata only. */}
                <PersonAvatar name={m.name} seed={m.memberId} size={36} className="flex-none" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">
                    {m.name}
                    {m.isMinor ? (
                      <span className="text-[11px] text-ink-3">{" (minor)"}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-ink-3">
                    {m.code}
                    {m.batches.length > 0 ? (
                      <span className="text-ink-3"> · {m.batches.join(", ")}</span>
                    ) : null}
                  </p>
                </div>
                <OwnerIcon name="chevron" size={16} className="flex-none text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
