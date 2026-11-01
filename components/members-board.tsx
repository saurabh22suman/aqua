"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { listMembersAction } from "@/lib/actions/people";
import type { MemberListRow } from "@/lib/services/people";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { StatusBadge, MEMBER_STATUS_TONE } from "@/components/ui/StatusBadge";
import { ListToolbar, ToolbarField } from "@/components/member-list-toolbar";
import { SectionHeading } from "@/components/ui/PageHeader";
import { useMembersListNavigation } from "@/components/members-list-navigation";
import { formatPhoneIN } from "@/lib/phone";
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
  navigationNamespace = "default",
  terminology = DEFAULT_TERMINOLOGY,
}: {
  initialMembers: MemberListRow[];
  // W1-6 — set by the owner layout's facility switcher via the page's
  // `?facility=` param. The list-level filter is the global switcher
  // now; there is no second location control inside the board.
  initialLocationId?: string;
  // Server-derived tenant + actor namespace; stale/foreign history state is
  // discarded instead of crossed between accounts or academies.
  navigationNamespace?: string;
  // Closed-key vocab resolved by the parent server page; optional so
  // callers without tenant context render the generic terms.
  terminology?: TerminologyState;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestEpoch = useRef(0);
  const locationId = initialLocationId ?? "";
  const currentLocation = useRef(locationId);
  currentLocation.current = locationId;
  // Account, tenant or facility change: discard prior rows/filters/state.
  const resetKey = `${navigationNamespace}\u0000${locationId}`;
  const [shownResetKey, setShownResetKey] = useState(resetKey);
  if (shownResetKey !== resetKey) {
    setShownResetKey(resetKey);
    setMembers(initialMembers);
    setSearch("");
    setStatus("");
    setError("");
    setPending(false);
    requestEpoch.current += 1;
  }

  function refetch(next: { search?: string; status?: string; locationId?: string }) {
    const merged = { search, status, locationId, ...next };
    const epoch = ++requestEpoch.current;
    setError("");
    setPending(true);
    return (async () => {
      let applied = false;
      try {
        const rows = await listMembersAction({
          search: merged.search || undefined,
          status: (merged.status || undefined) as MemberListRow["status"] | undefined,
          locationId: merged.locationId || undefined,
        });
        if (epoch === requestEpoch.current && merged.locationId === currentLocation.current) {
          setMembers(rows);
          applied = true;
        }
      } catch {
        if (epoch === requestEpoch.current && merged.locationId === currentLocation.current) {
          setError("Could not refresh this list. Previous results are still shown.");
        }
      } finally {
        if (epoch === requestEpoch.current) setPending(false);
      }
      return applied;
    })();
  }

  const { save: persistNavigation } = useMembersListNavigation({
    namespace: navigationNamespace,
    locationId,
    apply: async (stored) => {
      setSearch(stored.search);
      setStatus(stored.status);
      return refetch({
        search: stored.search,
        status: stored.status,
        locationId,
      });
    },
  });

  function saveNavigationState(nextSearch: string, nextStatus: string) {
    persistNavigation(nextSearch, nextStatus, window.scrollY);
  }

  function rememberListScroll() {
    saveNavigationState(search, status);
  }

  const memberSingular = titleCase(resolveTerm(terminology, "member", 1));

  return (
    <div>
      {error ? <div role="alert" className="mb-3 text-[13px] text-ink-2">
        <p>{error}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => refetch({})}
          disabled={isPending}
          className="mt-1.5"
        >
          {`Retry ${resolveTerm(terminology, "member", 1)} search`}
        </Button>
      </div> : null}

      <ListToolbar label={`${resolveTerm(terminology, "member", 1)} filters`}>
        <ToolbarField
          id="members-search"
          label="Search members"
          width="flexible"
        >
          {(field) => (
            <div className="relative">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
              />
              <Input
                {...field}
                type="search"
                value={search}
                onChange={(e) => {
                  const next = e.target.value;
                  setSearch(next);
                  saveNavigationState(next, status);
                  refetch({ search: next });
                }}
                placeholder="Name or phone number"
                aria-label="Search members"
                className="pl-9"
                data-testid="members-search"
              />
            </div>
          )}
        </ToolbarField>

        <ToolbarField id="members-status" label="Status">
          {(field) => (
            <Select
              {...field}
              value={status}
              onChange={(e) => {
                const next = e.target.value;
                setStatus(next);
                saveNavigationState(search, next);
                refetch({ status: next });
              }}
              data-testid="members-status-filter"
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </ToolbarField>
      </ListToolbar>

      <section className="mt-4 rounded-card border border-line bg-paper">
        <div className="px-3.5 pt-3.5">
          <SectionHeading
            title={`${memberSingular} directory`}
            trailing={<span className="text-[12px] text-ink-3 tabular-nums">{members.length} {members.length === 1 ? "record" : "records"}</span>}
          />
        </div>
        <ul className="md:px-3.5" data-testid="members-list" aria-busy={isPending}>
          {members.length === 0 ? (
            <li className="list-none py-2">
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
              <li key={m.memberId} className="border-b border-line px-3.5 last:border-0 md:px-0">
                <Link
                  href={`/owner/members/${m.memberId}`}
                  data-testid="member-row"
                  onClick={rememberListScroll}
                  className="flex min-h-16 items-center gap-3 py-3"
                >
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-deck text-[13px] font-semibold text-ink-2">
                    {m.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase()).join("")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span data-testid="member-row-name" className="block break-words text-[14px] font-medium text-ink">
                      {m.fullName}{m.isMinor ? <span className="text-[11px] text-ink-3">{" (minor)"}</span> : null}
                    </span>
                    <span data-testid="member-row-meta" className="mt-0.5 block break-words text-[12px] text-ink-3">
                      {m.memberCode} · {m.locationName}
                      {m.phone ? <span data-testid="member-row-phone"> · {formatPhoneIN(m.phone)}</span> : null}
                    </span>
                  </span>
                  <span data-testid="member-row-status" className="shrink-0">
                    <StatusBadge tone={MEMBER_STATUS_TONE[m.status] ?? "neutral"}>{STATUS_LABELS[m.status]}</StatusBadge>
                  </span>
                  <span aria-hidden="true" className="hidden text-[12px] text-ink-3 md:inline">Open</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
