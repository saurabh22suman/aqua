"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PersonAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { STAFF_CARD } from "@/components/staff-ui/staff-page";
import type { CoachRosterRow } from "@/lib/services/coach-schedule";

// Inline client-side filter on top of the coach's roster. Search is
// non-sticky and scrolls away with the list, so it never competes
// with the bottom nav — a coach looking someone up poolside types
// their name and scrolls. A URL pattern would force a round-trip per
// keystroke on mobile, which is the wrong shape for the use case.
//
// Batch 4 — a native batch filter sits beside the same local search.
// It matches one whole batch name from this roster (never a substring),
// combines with the name/code search, and reports the count politely.
// The empty state clears both filters and returns focus to the search.
export function CoachRosterSearch({
  roster,
  memberNouns,
}: {
  roster: CoachRosterRow[];
  /** The tenant-resolved plural noun, so no copy is hardcoded. */
  memberNouns?: string;
}) {
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const noun = memberNouns ?? "roster";

  const batches = useMemo(
    () => Array.from(new Set(roster.flatMap((member) => member.batches))).sort(),
    [roster],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster.filter((member) => {
      if (batch && !member.batches.includes(batch)) return false;
      if (!q) return true;
      return (
        member.name.toLowerCase().includes(q) ||
        member.code.toLowerCase().includes(q) ||
        member.batches.some((name) => name.toLowerCase().includes(q))
      );
    });
  }, [roster, query, batch]);

  const filtering = query.trim().length > 0 || batch.length > 0;

  function clearFilters() {
    setQuery("");
    setBatch("");
    searchRef.current?.focus();
  }

  if (roster.length === 0) return null;

  return (
    <>
      <div className={`mt-4 p-3 ${STAFF_CARD}`}>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(160px,0.55fr)]">
          <div className="min-w-0">
            <label
              htmlFor="coach-roster-search"
              className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3"
            >
              Search {noun}
            </label>
            <div className="relative mt-1">
              <OwnerIcon
                name="search"
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
              />
              <Input
                ref={searchRef}
                id="coach-roster-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, code or batch"
                className="pl-11"
              />
            </div>
          </div>
          <div className="min-w-0">
            <label
              htmlFor="coach-roster-batch"
              className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3"
            >
              Batch
            </label>
            <Select
              id="coach-roster-batch"
              value={batch}
              onChange={(event) => setBatch(event.target.value)}
              className="mt-1"
            >
              <option value="">All batches</option>
              {batches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-[11.5px] leading-snug text-ink-3"
        >
          {filtering
            ? `${filtered.length} of ${roster.length} ${noun} match`
            : `${roster.length} ${noun}`}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className={`mt-3 px-4 py-8 text-center ${STAFF_CARD}`}>
          <p className="text-[14px] font-medium text-ink">
            No {noun} match these filters.
          </p>
          <p className="mt-1 text-[12px] leading-snug text-ink-3">
            Try another name, code or batch, or clear both filters.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={clearFilters}
            className="mt-3"
          >
            Clear filters
          </Button>
        </div>
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
                  <p className="text-[14px] font-medium leading-snug text-ink [overflow-wrap:anywhere]">
                    {m.name}
                    {m.isMinor ? (
                      <span className="text-[11px] text-ink-3">{" (minor)"}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-ink-3 [overflow-wrap:anywhere]">
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
