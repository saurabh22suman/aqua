"use client";

import { useState } from "react";
import { InvitationRow } from "@/components/invitations/invitation-row";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";

// Phase 3.6 — invitations board. List with state pills, per-row
// revoke + login-link issue. There is no delivery channel yet (no
// SMS, no WhatsApp), so the board never claims anything was sent:
// issuing a link shows the link to copy, with the expiry, and says
// plainly to share it by hand. "Resend reminder" used to sit here
// calling an endpoint that returned { delivered: false } and showed
// nothing -- a button that pretends to send. It is gone; the link
// panel below is the honest replacement, for invited rows (first
// login) and active rows (re-login when a session dies) alike.
//
// F4 audit correction (Sep 2026): status pills used to colour
// "invited" with the warn semantic token and "active" with the
// good semantic token. Those are reserved for money and
// attendance state (DESIGN.md §1.1). Invitation state is neither
// — it is "has this staff member accepted the invite?", a binary
// lifecycle. The pill text ("Invited" / "Active") is the source
// of truth; the colour is now neutral ink. Same fix as the F4
// audit applied to other recently-added surfaces (onboarding-
// checklist, branding-form, terminology-form, staff-invite-form).

const STATUS_LABEL: Record<ListInvitationsRow["status"], string> = {
  invited: "Invited",
  active: "Active",
  revoked: "Revoked",
};

export type InvitationState = "all" | "invited" | "active" | "revoked";

const STATE_ORDER: InvitationState[] = ["all", "invited", "active", "revoked"];

const STATE_TITLE: Record<InvitationState, string> = {
  all: "All",
  invited: "Invited",
  active: "Active",
  revoked: "Revoked",
};

function stateHref(state: InvitationState): string {
  return state === "all"
    ? "/owner/staff/invitations"
    : `/owner/staff/invitations?state=${state}`;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  coach: "Coach",
  receptionist: "Receptionist",
  accountant: "Accountant",
  worker: "Worker",
};

function roleLabel(roleKey: string): string {
  return (
    ROLE_LABEL[roleKey] ??
    roleKey
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function InvitationsBoard({
  rows,
  state = "all",
  compactFilters = false,
}: {
  rows: ListInvitationsRow[];
  state?: InvitationState;
  compactFilters?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [filtersOpen, setFiltersOpen] = useState(false);

  if (rows.length === 0) {
    return (
      <div className="rounded-ctl border border-line bg-paper">
        {/* An invitation list is about login access, not the staff roster.
            The empty state names the real task and does not imply anything
            was sent. */}
        <EmptyState
          title="No invitations yet"
          body="Inviting a coach, receptionist or manager creates pending login access. Nothing is sent until you generate a link and share it directly."
          action={{
            label: "Invite your first staff member",
            href: "/owner/staff/invitations/new",
          }}
        />
      </div>
    );
  }

  const counts = {
    all: rows.length,
    invited: rows.filter((row) => row.status === "invited").length,
    active: rows.filter((row) => row.status === "active").length,
    revoked: rows.filter((row) => row.status === "revoked").length,
  } satisfies Record<InvitationState, number>;
  const scopedRows =
    state === "all" ? rows : rows.filter((row) => row.status === state);
  const needle = query.trim().toLocaleLowerCase("en-IN");
  const matching = needle
    ? scopedRows.filter((row) =>
        [
          row.fullName ?? "",
          row.phone,
          roleLabel(row.roleKey),
          STATUS_LABEL[row.status],
          row.allLocations ? "all clubs" : row.locationNames.join(" "),
        ]
          .join(" ")
          .toLocaleLowerCase("en-IN")
          .includes(needle),
      )
    : scopedRows;
  const visible = sort === "pending"
    ? [...matching].sort((left, right) => Number(right.status === "invited") - Number(left.status === "invited"))
    : matching;

  const sortControl = (
    <label htmlFor="invitation-sort" className="grid gap-1 text-sm font-medium">
      Sort invitations
      <select id="invitation-sort" value={sort} onChange={event => setSort(event.target.value)}
        className="min-h-11 rounded-ctl border border-line bg-paper px-3 text-[16px]">
        <option value="recent">Recent first</option>
        <option value="pending">Pending first</option>
      </select>
    </label>
  );
  const stateNavigation = (
    <nav aria-label="Invitation state" className="flex flex-wrap items-center gap-1.5">
      {STATE_ORDER.map(entry => (
        <Link key={entry} href={stateHref(entry)} aria-current={entry === state ? "page" : undefined}
          onClick={compactFilters ? () => setFiltersOpen(false) : undefined}
          className={`inline-flex min-h-11 items-center rounded-pill px-3 text-[13px] font-medium ${entry === state
            ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-ink-2 hover:text-ink"}`}>
          {STATE_TITLE[entry]} {counts[entry]}
        </Link>
      ))}
    </nav>
  );
  const sortLabel = sort === "pending" ? "Pending first" : "Recent first";

  return (
    <section
      data-testid="invitations-surface"
      className="overflow-hidden rounded-card border border-line bg-paper"
    >
      <div className="border-b border-line px-4 py-3">
        {!compactFilters ? stateNavigation : null}
        <div className={`${compactFilters ? "" : "mt-2 "}flex flex-wrap items-center gap-2`}>
          <Input
            type="search"
            role="searchbox"
            aria-label="Find an invitation"
            placeholder={compactFilters ? "Search invitations" : "Search name, phone, role or club"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="sm:max-w-xs"
            autoComplete="off"
          />
          {compactFilters ? <>
            <button type="button" className="owner-period-pill" aria-label="Invitation filters"
              aria-describedby="invitation-filter-summary" aria-haspopup="dialog" aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(true)}>
              <span id="invitation-filter-summary">{state === "all" ? "All invitations" : STATE_TITLE[state]} · {sortLabel}</span>
              <OwnerIcon name="down" size={13} />
            </button>
            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen} title="Invitation filters" swipeToClose
              footer={<Button type="button" onClick={() => setFiltersOpen(false)}>Done</Button>}>
              {filtersOpen ? <div className="space-y-3">{stateNavigation}{sortControl}</div> : null}
            </Dialog>
          </> : sortControl}
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="inline-flex min-h-11 items-center rounded-ctl px-3 text-[13px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
            >
              Clear invitation search
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-[12px] text-ink-3" role="status">
          {needle
            ? `${visible.length} of ${scopedRows.length} ${state === "all" ? "invitations" : STATE_TITLE[state].toLocaleLowerCase()}`
            : `${scopedRows.length} ${state === "all" ? "invitations" : STATE_TITLE[state].toLocaleLowerCase()}`}
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-[14px] font-medium">
            {needle
              ? `No invitation matches “${query.trim()}”`
              : `No ${STATE_TITLE[state].toLocaleLowerCase()} invitations`}
          </p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {needle
              ? "Clear the search to see this list again."
              : "The other invitation states may still have people in them."}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2">
            {needle ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
              >
                Clear invitation search
              </button>
            ) : state !== "all" ? (
              <Link
                href={stateHref("all")}
                className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
              >
                Show all invitations
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {!compactFilters ? <div
            data-testid="invitations-head"
            className="hidden border-b border-line px-4 py-2 text-[11px] uppercase tracking-[0.1em] text-ink-3 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,.8fr)_minmax(0,1fr)_auto_minmax(0,1.2fr)] lg:items-center lg:gap-3"
          >
            <span>Person</span>
            <span>Role</span>
            <span>Club access</span>
            <span>State</span>
            <span className="sr-only">Action</span>
          </div> : null}
          <ul data-testid="invitations-list" className="divide-y divide-line">
            {visible.map((r) => (
              <InvitationRow key={r.membershipId} row={r} compact={compactFilters}
                roleName={roleLabel(r.roleKey)} statusName={STATUS_LABEL[r.status]} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
