"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { listMembersAction } from "@/lib/actions/people";
import {
  resolveTerm,
  titleCase,
  type TerminologyState,
} from "@/lib/terminology/keys";
import type { MemberListRow } from "@/lib/services/people";

// K-07 — optional member lookup for the café counter. Reuses the
// existing people/actions search surface (listMembersAction returns
// members, which is what an order needs; searchPersonsAction returns
// persons for guardian linking and cannot be billed).
//
// 16px input per DESIGN.md §2 — anything smaller triggers iOS
// zoom-on-focus.

const inputClass =
  "w-full min-h-11 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

export function CafeMemberPicker({
  member,
  terminology,
  onSelect,
  disabled = false,
}: {
  member: MemberListRow | null;
  terminology: TerminologyState;
  onSelect: (member: MemberListRow | null) => void;
  disabled?: boolean;
}) {
  const memberOne = titleCase(resolveTerm(terminology, "member", 1));
  const memberOther = resolveTerm(terminology, "member", "other");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberListRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await listMembersAction({ search: query.trim() }));
      setSearched(true);
    } catch {
      setError("Could not search members.");
    } finally {
      setSearching(false);
    }
  }

  if (member) {
    return (
      <section
        className="rounded-card border border-line bg-paper p-4"
        data-testid="cafe-member"
      >
        <p className="text-[12px] text-ink-3">{memberOne}</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-ink truncate">
              {member.fullName}
            </p>
            <p className="text-[12px] text-ink-3">{member.memberCode}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onSelect(null)}
            aria-label="Clear member"
          >
            Clear
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-card border border-line bg-paper p-4"
      data-testid="cafe-member"
    >
      <label className="block">
        <span className="block text-[12px] font-medium text-ink-2 mb-1">
          {memberOne} (optional)
        </span>
        <div className="flex items-stretch gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
            placeholder="Name, phone or member code"
            className={inputClass}
            disabled={disabled}
            data-testid="cafe-member-search"
          />
          <Button
            size="sm"
            onClick={search}
            disabled={disabled || searching || query.trim().length === 0}
            aria-label="Search members"
          >
            <Search size={16} strokeWidth={2} />
            Search
          </Button>
        </div>
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-ink-2">
          {error}
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul className="mt-3 border-t border-line divide-y divide-line">
          {results.map((row) => (
            <li key={row.memberId}>
              <button
                type="button"
                onClick={() => {
                  onSelect(row);
                  setResults([]);
                  setSearched(false);
                  setQuery("");
                }}
                className="w-full min-h-[44px] px-1 py-2 text-left"
                data-testid={`cafe-member-option-${row.memberId}`}
              >
                <span className="text-[14px] text-ink">{row.fullName}</span>
                <span className="ml-2 text-[12px] text-ink-3">
                  {row.memberCode}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : searched && !searching ? (
        <p className="mt-2 text-[12px] text-ink-3">
          No {memberOther} found. A walk-in order can be recorded but not
          billed.
        </p>
      ) : null}
    </section>
  );
}
