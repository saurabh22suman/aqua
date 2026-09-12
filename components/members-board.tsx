"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { listMembersAction } from "@/lib/actions/people";
import type { MemberListRow } from "@/lib/services/people";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatPhoneIN } from "@/lib/phone";
import { formatDateIST } from "@/lib/time/tz";
import { resolveTerm, type TerminologyState } from "@/lib/terminology/keys";

const DEFAULT_TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };

const STATUS_LABELS: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  paused: "Paused",
  lapsed: "Lapsed",
  left: "Left",
};

const STATUS_TONE: Record<string, string> = {
  trial: "bg-warn-soft text-warn",
  active: "bg-good-soft text-good",
  paused: "bg-warn-soft text-warn",
  lapsed: "bg-late-soft text-late",
  left: "bg-deck text-ink-3",
};

export function MembersBoard({
  initialMembers,
  initialLocationId,
  terminology = DEFAULT_TERMINOLOGY,
}: {
  initialMembers: MemberListRow[];
  // W1-6 — set by the owner layout's facility switcher via the page's
  // `?facility=` param. The list-level filter is the global switcher
  // now; there is no second location control inside the board.
  initialLocationId?: string;
  // Closed-key vocab resolved by the parent server page; optional so
  // callers without tenant context render the generic terms.
  terminology?: TerminologyState;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  // W1-6 — the facility comes from the URL via the page; the board's
  // other filters are local state. A facility change is a server
  // navigation (the switcher pushes `?facility=`), so this never needs
  // a setter.
  const locationId = initialLocationId ?? "";
  const [isPending, startTransition] = useTransition();

  function refetch(next: { search?: string; status?: string; locationId?: string }) {
    const merged = { search, status, locationId, ...next };
    startTransition(async () => {
      const rows = await listMembersAction({
        search: merged.search || undefined,
        status: (merged.status || undefined) as MemberListRow["status"] | undefined,
        locationId: merged.locationId || undefined,
      });
      setMembers(rows);
    });
  }

  return (
    <div>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            refetch({ search: e.target.value });
          }}
          placeholder="Search by name or phone"
          className="w-full rounded-ctl border border-line bg-paper py-2.5 pl-9 pr-3 text-[16px]"
          data-testid="members-search"
        />
      </div>

      <div className="mt-2.5 flex gap-2">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            refetch({ status: e.target.value });
          }}
          className="rounded-ctl border border-line bg-paper px-2.5 py-2 text-[16px]"
          data-testid="members-status-filter"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <ul className="mt-3" data-testid="members-list" aria-busy={isPending}>
        {members.length === 0 ? (
          <li className="rounded-ctl border border-line bg-paper list-none">
            {search || status || locationId ? (
              <EmptyState
                title={`No ${resolveTerm(terminology, "member", "other")} match.`}
              />
            ) : (
              <EmptyState
                title={`No ${resolveTerm(terminology, "member", "other")} yet.`}
                body={`Add your first ${resolveTerm(terminology, "member", 1)} to start building the roster.`}
                action={{
                  label: `Add your first ${resolveTerm(terminology, "member", 1)}`,
                  href: "/owner/members/new",
                }}
              />
            )}
          </li>
        ) : (
          members.map((m) => (
            <li key={m.memberId} className="border-b border-line last:border-0">
              <Link
                href={`/owner/members/${m.memberId}`}
                className="flex items-center gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">
                    {m.fullName}
                    {m.isMinor ? <span className="text-[11px] text-ink-3">{" (minor)"}</span> : null}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {m.memberCode} · {m.locationName}
                    {m.phone ? ` · ${formatPhoneIN(m.phone)}` : ""}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    Joined {formatDateIST(m.createdAt)}
                  </p>
                </div>
                <span
                  className={`flex-none rounded-pill px-2.5 py-1 text-[11px] font-medium ${STATUS_TONE[m.status]}`}
                >
                  {STATUS_LABELS[m.status]}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
