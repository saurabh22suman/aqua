"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { listMembersAction } from "@/lib/actions/people";
import type { MemberListRow } from "@/lib/services/people";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, MEMBER_STATUS_TONE } from "@/components/ui/StatusBadge";
import { formatPhoneIN } from "@/lib/phone";
import { formatDateIST } from "@/lib/time/tz";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";

const DEFAULT_TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };

const STATUS_LABELS: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  paused: "Paused",
  lapsed: "Lapsed",
  left: "Left",
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
          className="w-full min-h-11 rounded-ctl border border-line bg-paper py-2.5 pl-9 pr-3 text-[16px]"
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
          aria-label="Status"
          className="min-h-11 rounded-ctl border border-line bg-paper px-2.5 py-2 text-[16px]"
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

      {/* PR3-C3/C4 — desktop column header; the rows below share the
          same grid so the roster scans and compares at 1280px while the
          phone keeps the one-column card rows. */}
      <div
        data-testid="members-table-head"
        className="mt-4 hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 border-b border-line pb-2 text-[11px] uppercase tracking-[0.1em] text-ink-3 md:grid"
      >
        <span>{titleCase(resolveTerm(terminology, "member", 1))}</span>
        <span>Phone</span>
        <span>Joined</span>
        <span className="text-right">Status</span>
      </div>
      <ul className="mt-3 md:mt-0" data-testid="members-list" aria-busy={isPending}>
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
                className="flex items-center gap-3 py-3 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">
                    {m.fullName}
                    {m.isMinor ? <span className="text-[11px] text-ink-3">{" (minor)"}</span> : null}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3 md:truncate">
                    {m.memberCode} · {m.locationName}
                    <span className="md:hidden">
                      {m.phone ? ` · ${formatPhoneIN(m.phone)}` : ""}
                    </span>
                  </p>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-3 md:hidden">
                  Joined {formatDateIST(m.joinedOn)}
                </p>
                <p className="hidden truncate text-[12.5px] text-ink-2 md:block">
                  {m.phone ? formatPhoneIN(m.phone) : "—"}
                </p>
                <p className="hidden text-[12.5px] text-ink-3 md:block">
                  {formatDateIST(m.joinedOn)}
                </p>
                <StatusBadge tone={MEMBER_STATUS_TONE[m.status] ?? "neutral"}>
                  {STATUS_LABELS[m.status]}
                </StatusBadge>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
