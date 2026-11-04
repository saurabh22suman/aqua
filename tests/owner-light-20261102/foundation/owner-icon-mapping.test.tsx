// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

// Foundation — the Owner icon mapping must never lie.
//
// The independent review (2 November 2026) found the latent defect in
// the shared resolver: an UNMAPPED destination fell back to the house
// glyph, so a destination nobody mapped would silently be drawn as
// "Home" — a wrong, meaningful symbol on a navigation row.
//
// This file pins:
//
//   1. every destination the Owner navigation can show, and the exact
//      OwnerIcon name it must draw (the table below is the mapping of
//      record, so a future change cannot silently move a glyph);
//   2. the ledger destination (Fees & payments) draws the approved
//      "money" glyph — the meaningful domain glyph, documented here
//      rather than assumed;
//   3. an unmapped destination NEVER becomes the house: the resolver
//      must fail loudly (or return a distinct, documented value) so the
//      gap is visible instead of painted.
//
// The shared navigation registry (lib/nav.ts, components/bottom-nav.tsx)
// is NOT touched: coach, reception and Ops keep their icons.

import { ownerIconName } from "@/components/owner-ui/owner-navigation";
import { OWNER_SIDEBAR_GROUPS } from "@/lib/nav";
import type { OwnerIconName } from "@/components/owner-ui/owner-icon";

// The Owner destinations and the glyph each one draws.
const EXPECTED: Array<[string, string, OwnerIconName]> = [
  ["/owner", "layout-dashboard", "home"],
  ["/owner/members", "users", "members"],
  ["/owner/schedule", "calendar-range", "calendar"],
  ["/owner/bookings", "calendar-days", "booking"],
  ["/owner/programs", "calendar-days", "programs"],
  ["/owner/batches", "calendar-days", "programs"],
  ["/owner/sessions", "user-cog", "calendar"],
  // The ledger: "Fees & payments" draws the approved MONEY glyph.
  ["/owner/fees", "receipt", "money"],
  ["/owner/enquiries", "clipboard-list", "enquiry"],
  ["/owner/announcements", "megaphone", "bell"],
  ["/owner/staff", "briefcase", "staff"],
  ["/owner/reports", "file-text", "reports"],
  ["/owner/settings", "settings", "settings"],
];

describe("the Owner icon mapping", () => {
  it("draws the agreed glyph for every Owner destination", () => {
    for (const [href, iconName, expected] of EXPECTED) {
      expect(
        ownerIconName({ href, iconName }),
        `${href} must draw "${expected}"`,
      ).toBe(expected);
    }
  });

  it("keeps the registry-key fallback for a known key", () => {
    // A destination the Owner tree has not mapped yet keeps a
    // consistent existing outline — documented, never unrelated.
    expect(ownerIconName({ href: "/owner/new", iconName: "list-checks" })).toBe(
      "check",
    );
    expect(ownerIconName({ href: "/owner/new", iconName: "user-plus" })).toBe(
      "userplus",
    );
  });

  it("maps every destination the Owner registry can show", () => {
    // The mapping of record must cover EVERY destination the registry
    // can show: a new destination without an explicit mapping fails
    // here, in CI, instead of borrowing another destination's glyph.
    const registryDestinations = OWNER_SIDEBAR_GROUPS.flatMap((group) =>
      group.items.map((item) => item.href),
    );
    const mapped = EXPECTED.map(([href]) => href);
    for (const href of registryDestinations) {
      expect(mapped, `${href} has no explicit Owner icon mapping`).toContain(
        href,
      );
    }
  });

  it("falls back to the neutral shared glyph, never to the house", () => {
    // RED: the resolver returned "home" for anything it did not know,
    // so an unmapped destination would be painted as "Home". The
    // runtime fallback is the neutral More glyph — meaningful, and it
    // never crashes the owner shell.
    expect(
      ownerIconName({ href: "/owner/unmapped", iconName: "unknown-key" }),
      "an unmapped destination must not borrow the house glyph",
    ).toBe("more");
  });
});
