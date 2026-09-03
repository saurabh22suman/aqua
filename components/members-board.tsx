"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { listMembersAction } from "@/lib/actions/people";
import type { LocationOption, MemberListRow } from "@/lib/services/people";

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
  locations,
}: {
  initialMembers: MemberListRow[];
  locations: LocationOption[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [locationId, setLocationId] = useState("");
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

  const showLocationFilter = useMemo(() => locations.length > 1, [locations]);

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
          className="w-full rounded-ctl border border-line bg-paper py-2.5 pl-9 pr-3 text-[14px]"
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
          className="rounded-ctl border border-line bg-paper px-2.5 py-2 text-[13px]"
          data-testid="members-status-filter"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {showLocationFilter ? (
          <select
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              refetch({ locationId: e.target.value });
            }}
            className="rounded-ctl border border-line bg-paper px-2.5 py-2 text-[13px]"
            data-testid="members-location-filter"
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <ul className="mt-3" data-testid="members-list" aria-busy={isPending}>
        {members.length === 0 ? (
          <li className="rounded-ctl border border-line bg-paper px-4 py-8 text-center">
            <p className="text-[13px] text-ink-3">
              {search || status || locationId ? "No members match." : "No members yet."}
            </p>
            {search || status || locationId ? null : (
              <Link
                href="/owner/members/new"
                className="mt-4 inline-flex items-center justify-center rounded-pill px-5 py-3 text-[14.5px] font-semibold text-paper bg-[var(--accent)]"
              >
                Add your first member
              </Link>
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
                    {m.isMinor ? <span className="ml-1.5 text-[11px] text-ink-3">(minor)</span> : null}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {m.memberCode} · {m.locationName}
                    {m.phone ? ` · ${m.phone}` : ""}
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
