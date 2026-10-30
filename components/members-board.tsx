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
  const memberSinceLabel = `${memberSingular} since`;

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

      {/* OpenPen owner reference — the directory is one bounded surface with
          a named heading, and the row compares identity, phone, joining date
          and participation. The whole row stays the single action. */}
      <section className="mt-4 rounded-card border border-line bg-paper">
        <div className="px-3.5 pt-3.5">
          <SectionHeading
            title={`${titleCase(resolveTerm(terminology, "member", 1))} directory`}
            trailing={
              <span className="text-[12px] text-ink-3 tabular-nums">
                {members.length} {members.length === 1 ? "record" : "records"}
              </span>
            }
          />
        </div>
        <div
          data-testid="members-table-head"
          className="mt-2 hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-line px-3.5 pb-2 text-[11px] uppercase tracking-[0.1em] text-ink-3 md:grid"
        >
          <span>{memberSingular}</span>
          <span>Phone</span>
          <span>{memberSinceLabel}</span>
          <span>Status</span>
          <span className="sr-only">Action</span>
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
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3 md:grid md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_auto_auto_auto] md:items-center md:gap-3"
                >
                  <p
                    data-testid="member-row-name"
                    className="col-start-1 row-start-1 min-w-0 text-[14px] font-medium break-words"
                  >
                    {m.fullName}
                    {m.isMinor ? <span className="text-[11px] text-ink-3">{" (minor)"}</span> : null}
                  </p>
                  <span
                    data-testid="member-row-status"
                    className="col-start-2 row-start-1 flex justify-self-end md:col-start-4 md:row-start-1 md:justify-self-start"
                  >
                    <StatusBadge tone={MEMBER_STATUS_TONE[m.status] ?? "neutral"}>
                      {STATUS_LABELS[m.status]}
                    </StatusBadge>
                  </span>
                  <p
                    data-testid="member-row-meta"
                    className="col-start-1 row-start-2 truncate text-[12px] text-ink-3 md:row-start-2"
                  >
                    {m.memberCode} · {m.locationName}
                  </p>
                  <p
                    data-testid="member-row-phone"
                    className="col-start-1 row-start-3 text-[12.5px] text-ink-2 tabular-nums md:col-start-2 md:row-start-1"
                  >
                    <span className="mr-1 text-[11px] uppercase tracking-[0.08em] text-ink-3 md:hidden">
                      Phone
                    </span>
                    {m.phone ? formatPhoneIN(m.phone) : "—"}
                  </p>
                  <p
                    data-testid="member-row-joined"
                    className="col-start-1 row-start-4 text-[12px] text-ink-3 tabular-nums md:col-start-3 md:row-start-1"
                  >
                    <span className="mr-1 text-[11px] uppercase tracking-[0.08em] text-ink-3 md:hidden">
                      {memberSinceLabel}
                    </span>
                    {formatDateIST(m.joinedOn)}
                  </p>
                  <span
                    aria-hidden="true"
                    className="hidden text-[12.5px] font-medium text-[var(--accent-ink)] md:col-start-5 md:row-start-1 md:inline"
                  >
                    Open
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
