// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — the prefetch contract.
//
// Root's causal diagnostic: normal production SPA `profile → Edit → Cancel`
// stalls on a PREFETCHED RSC payload, and aborting every automatic
// `next-router-prefetch=1` request makes all 21 Owner journeys complete.
// The Owner pages therefore read on navigation rather than opportunistically
// prefetching in the background.
//
// The approved mechanism is a small shared OwnerLink facade over next/link
// (Foundation owns `components/owner-ui/owner-link.tsx`). This lane's part is
// to make every OWNED Owner link request it.
//
// INTENDED RED (this file): an owned rendered navigation component today
// passes NO `prefetch` prop for its Owner destinations, so next/link receives
// `undefined` and prefetches automatically. The spy records exactly what was
// requested — no facade is imported, so this cannot fail as a missing module.
//
// No database: every server action is stubbed.

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RequestedLink = { href: string; prefetch: unknown };

const requested = vi.hoisted(() => [] as Array<{ href: string; prefetch: unknown }>);

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      prefetch?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, prefetch, children, ...rest } = props;
      const resolved = typeof href === "string" ? href : String(href);
      requested.push({ href: resolved, prefetch });
      return React.createElement(
        "a",
        { href: resolved, ...rest },
        children as React.ReactNode,
      );
    },
  };
});

const listMembersAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
  updateMemberAction: vi.fn(async () => ({ ok: true })),
  searchPersonsAction: vi.fn(async () => []),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { MembersBoard } from "@/components/members-board";
import { StaffBoard } from "@/components/staff-board";
import { MemberEditForm } from "@/components/member-edit-form";
import { EnquiriesBoard } from "@/components/enquiries-board";
import type { MemberListRow } from "@/lib/services/people";
import type { StaffRow } from "@/lib/services/staff";

const FACILITY = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "11111111-1111-4111-8111-111111111111";

const MEMBER: MemberListRow = {
  memberId: MEMBER_ID,
  personId: "p1",
  fullName: "Aaradhya Iyer",
  phone: "+919812340099",
  memberCode: "M-01",
  status: "active",
  locationId: FACILITY,
  locationName: "Worli Main",
  isMinor: false,
  createdAt: "2026-10-01T00:00:00Z",
  joinedOn: "2026-10-01",
};

const STAFF: StaffRow = {
  id: "staff-1",
  personId: "person-1",
  fullName: "Aanya Rao",
  staffType: "coach",
  userId: "user-1",
  employedOn: "2026-06-01",
} as StaffRow;

const EDIT_MEMBER = {
  memberId: MEMBER_ID,
  fullName: "Aaradhya Iyer",
  phone: "+919812340099",
  memberCode: "M-01",
  locationId: FACILITY,
  locationName: "Worli Main",
  isMinor: false,
  status: "active",
  joinedOn: "2026-10-10",
  dateOfBirth: "2015-01-01",
  gender: null,
  medicalNotes: null,
  guardians: [],
  consents: [],
  statusHistory: [],
} as never;

const ENQUIRY = {
  enquiryId: "enquiry-1",
  fullName: "Rhea Kapoor",
  phone: "+919812340010",
  source: "walk-in",
  status: "new",
  createdAt: "2026-10-01T00:00:00Z",
  locationId: FACILITY,
  locationName: "Worli Main",
  stage: "new",
} as never;

/** Owner destinations: `/owner`, `/owner/*`, `/owner?...`, `/owner#...`. */
function isOwnerDestination(href: string): boolean {
  return /^\/owner(?:[/?#]|$)/.test(href);
}

function ownerLinks(): RequestedLink[] {
  return requested.filter((entry) => isOwnerDestination(entry.href));
}

beforeEach(() => {
  requested.length = 0;
  listMembersAction.mockReset();
  listMembersAction.mockResolvedValue([MEMBER]);
});

afterEach(() => {
  cleanup();
});

describe("owner links request no automatic prefetch", () => {
  // INTENDED RED: the member rows are Owner links and today request the
  // automatic prefetch (no `prefetch` prop at all).
  it("asks for no prefetch on the member rows", () => {
    render(
      <MembersBoard
        initialMembers={[MEMBER]}
        initialLocationId={FACILITY}
        navigationNamespace="tenant-1:user-1"
      />,
    );
    const rows = ownerLinks();
    expect(rows.length).toBeGreaterThan(0);
    for (const entry of rows) {
      expect(
        entry.prefetch,
        `${entry.href} still asks next/link to prefetch`,
      ).toBe(false);
    }
  });

  // INTENDED RED: the staff directory rows are Owner links too.
  it("asks for no prefetch on the staff rows", () => {
    render(<StaffBoard rows={[STAFF]} />);
    const rows = ownerLinks();
    expect(rows.length).toBeGreaterThan(0);
    for (const entry of rows) {
      expect(entry.prefetch, `${entry.href} still prefetches`).toBe(false);
    }
  });

  // INTENDED RED: the edit form's Cancel is an Owner link.
  it("asks for no prefetch on the edit form's Cancel", () => {
    render(
      <MemberEditForm
        member={EDIT_MEMBER}
        locations={[]}
        returnHref={`/owner/members/${MEMBER_ID}?facility=${FACILITY}`}
      />,
    );
    const cancel = ownerLinks().find((entry) => entry.href.includes("?facility="));
    expect(cancel, "the Cancel link was not rendered as an owner link").toBeTruthy();
    expect(cancel!.prefetch, "Cancel still prefetches").toBe(false);
  });

  // CONTROL: the same shared board on a NON-owner surface keeps its prior
  // default — the facade must not change other roles.
  it("leaves a non-owner consumer's default untouched", () => {
    render(
      <EnquiriesBoard
        initialEnquiries={[ENQUIRY]}
        locations={[{ id: FACILITY, name: "Worli Main" }]}
        canWrite={false}
        detailHrefPrefix="/reception/enquiries"
      />,
    );
    const nonOwner = requested.filter(
      (entry) => !isOwnerDestination(entry.href) && entry.href !== "#",
    );
    expect(nonOwner.length).toBeGreaterThan(0);
    for (const entry of nonOwner) {
      expect(entry.prefetch, `${entry.href} was changed for another role`).toBe(
        undefined,
      );
    }
  });

  // CONTROL: destinations, queries and hashes are untouched — the facade
  // only changes the prefetch request.
  it("keeps every destination, query and hash intact", () => {
    render(
      <MembersBoard
        initialMembers={[MEMBER]}
        initialLocationId={FACILITY}
        navigationNamespace="tenant-1:user-1"
      />,
    );
    const hrefs = requested.map((entry) => entry.href);
    expect(hrefs).toContain(`/owner/members/${MEMBER_ID}?facility=${FACILITY}`);
  });
});
