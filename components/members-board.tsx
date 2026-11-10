"use client";

import { useRef, useState } from "react";
import { listMembersAction } from "@/lib/actions/people";
import type { MemberListRow } from "@/lib/services/people";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ListToolbar, ToolbarField } from "@/components/member-list-toolbar";
import { MemberList, type MemberListEmptyKind } from "@/components/member-list";
import { MemberStatusFilter } from "@/components/member-status-filter";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import {
  clearMembersReturnIntent,
  recordMembersReturnIntent,
  useMembersListNavigation,
} from "@/components/members-list-navigation";
import { DEFAULT_TERMS, type TerminologyState } from "@/lib/terminology/keys";

const DEFAULT_TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };

const STATUS_LABELS: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  paused: "Paused",
  lapsed: "Lapsed",
  left: "Left",
};

// The status filter's options: every REAL status the product has, plus
// "All" — which is every status, not an invented one. There is no "On
// hold": a member is trial, active, paused, lapsed or left.
const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

export function MembersBoard({
  initialMembers,
  initialLocationId,
  navigationNamespace = "default",
  terminology = DEFAULT_TERMINOLOGY,
  canWrite = true,
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
  /**
   * Whether the caller may add a member. The board owns the empty
   * message, so it has to be true for the role reading it: the add verb
   * is offered only where it is permitted ("No members yet → 'Add
   * member', where permitted" — UI-UX.txt §6). A caller who may only
   * read is not told to add one.
   */
  canWrite?: boolean;
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
          // The failure owns the list: the alert beside it says what
          // happened, so the copy must not also claim that a previous
          // result is still on screen when there is none.
          setError(
            members.length > 0
              ? "Could not refresh this list. Previous results are still shown."
              : "Could not refresh this list.",
          );
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
    // The owner is leaving for a profile: remember what this directory
    // was showing, so its own back link can bring it back.
    recordMembersReturnIntent({
      namespace: navigationNamespace,
      locationId,
      search,
      status,
      scrollY: window.scrollY,
    });
  }

  // The no-match state is a dead end unless the owner can leave it.
  //
  // ONE clear action drops the search text, the status filter and the
  // PERSISTED list state (the history entry and the armed return
  // intent), so Back never restores the filters the owner just
  // dismissed. The FACILITY SCOPE is untouched: clearing a filter never
  // widens the directory beyond the facility it was read under. The
  // rows come back from an AUTHORITATIVE read, never from the rows
  // that are already on screen.
  function clearFilters() {
    setSearch("");
    setStatus("");
    clearMembersReturnIntent();
    saveNavigationState("", "");
    void refetch({ search: "", status: "" });
  }

  // The club roster spans sports, so its person label stays generic.
  const memberTerm = {
    one: DEFAULT_TERMS[terminology.locale].member.one,
    other: DEFAULT_TERMS[terminology.locale].member.other,
  };
  // The drill-down keeps the scope the directory was read under: the
  // canonical selected facility, or an EXPLICIT "all" so a remembered
  // facility cookie can never narrow an all-facilities directory. A URL
  // without the query is normalised by the facility switcher with a hard
  // reload, which would erase the in-memory return intent.
  const scopeQuery = locationId ? `?facility=${locationId}` : "?facility=all";
  // Which empty state the list is in. The DECISION stays here: a failed
  // read is a failure, a filter that matched nothing is a no-match, and
  // a facility that holds nobody is simply empty.
  const emptyKind: MemberListEmptyKind = error
    ? "failed"
    : search || status
      ? "no-match"
      : "empty";

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
          {`Retry ${DEFAULT_TERMS[terminology.locale].member.one} search`}
        </Button>
      </div> : null}

      <ListToolbar label={`${DEFAULT_TERMS[terminology.locale].member.one} filters`}>
        <ToolbarField
          id="members-search"
          label="Search members"
          width="flexible"
        >
          {(field) => (
            <div className="relative">
              {/* The approved mock's magnifier, drawn by the shared owner
                  icon set (owner-only surface). */}
              <OwnerIcon
                name="search"
                size={16}
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

        {/* The status filter is a visible row of chips (the leaf owns
            the drawing); the board owns the choice, the navigation
            state it saves and the re-read it triggers. */}
        <MemberStatusFilter
          options={STATUS_FILTERS}
          value={status}
          onChange={(next) => {
            setStatus(next);
            saveNavigationState(search, next);
            refetch({ status: next });
          }}
        />
      </ListToolbar>

      <MemberList
        members={members}
        memberTerm={memberTerm}
        statusLabels={STATUS_LABELS}
        emptyKind={emptyKind}
        onClearFilters={clearFilters}
        scopeQuery={scopeQuery}
        onOpen={rememberListScroll}
        isPending={isPending}
        canWrite={canWrite}
      />
    </div>
  );
}
