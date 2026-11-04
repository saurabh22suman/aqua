// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the staff detail avatar.
//
// Human steering: "please use the name initials only, like others", and DESIGN
// specifies the flat themed initials surface. The staff detail page was the one
// surface still computing `w[0]` and painting a manual `bg-water-soft` /
// `text-water` square, so it disagreed with the shared PersonAvatar that the
// staff directory, the member chips and the profile already use.
//
// These regressions pin the real contract on a RENDERED page:
//   1. the avatar is the shared component and shows the SAME grapheme-safe
//      initials for the SAME displayed name — a Devanagari conjunct must stay
//      intact, which `w[0]` splits;
//   2. the surface is the flat themed tint, not the manual water colour;
//   3. it is decorative beside the existing heading (the name is the text);
//   4. it keeps the 56px profile shape;
//   5. the page's role control and the missing-staff 404 are unchanged.
//
// No database: the staff read is stubbed.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listStaffAction = vi.hoisted(() => vi.fn());
const getCurriculumLeadState = vi.hoisted(() => vi.fn());
const hasPermission = vi.hoisted(() =>
  vi.fn((ctx: { permissions: Set<string> }, key: string) =>
    ctx.permissions.has(key),
  ),
);

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: new Set(["staff.read", "settings.manage"]),
    features: new Set(),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));

vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (ctx: { permissions: Set<string> }, key: string) =>
    hasPermission(ctx, key),
}));

vi.mock("@/lib/actions/staff", () => ({
  listStaffAction: (...args: unknown[]) => listStaffAction(...args),
}));

vi.mock("@/lib/services/curriculum-lead", () => ({
  getCurriculumLeadState: (...args: unknown[]) => getCurriculumLeadState(...args),
}));

vi.mock("@/components/curriculum-lead-control", () => ({
  CurriculumLeadControl: ({ staffId }: { staffId: string }) => (
    <div data-testid="curriculum-lead-control" data-staff-id={staffId} />
  ),
}));

import StaffDetailPage from "@/app/(owner)/owner/staff/[staffId]/page";
import { personInitials } from "@/components/avatar";

const STAFF_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";

// A real Devanagari conjunct: "क्ष" is क + ् + ष (three code points, ONE
// grapheme). `w[0]` keeps only "क"; the shared initials keep the conjunct.
const FULL_NAME = "क्षमा देशपांडे";

const ROW = {
  id: STAFF_ID,
  personId: PERSON_ID,
  fullName: FULL_NAME,
  userId: null,
  staffType: "coach" as const,
  employedOn: "2026-10-01",
};

beforeEach(() => {
  listStaffAction.mockReset();
  listStaffAction.mockResolvedValue([ROW]);
  getCurriculumLeadState.mockReset();
  getCurriculumLeadState.mockResolvedValue({ isCurriculumLead: false });
  hasPermission.mockReset();
  hasPermission.mockReturnValue(true);
});

afterEach(cleanup);

async function renderPage(staffId = STAFF_ID) {
  return render(
    await StaffDetailPage({ params: Promise.resolve({ staffId }) }),
  );
}

describe("the staff detail avatar", () => {
  // RED: the page paints its own water-tinted square, so no shared avatar.
  it("uses the shared avatar with the same grapheme-safe initials", async () => {
    await renderPage();
    const avatar = screen.getByTestId("person-avatar");
    expect(avatar.textContent).toBe(personInitials(FULL_NAME));
    // The conjunct survives; a per-code-point initial would be "कद".
    expect(avatar.textContent).toContain("क्ष");
    expect(avatar.textContent).not.toBe("कद");
    // The displayed name is unchanged and intact beside it.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(FULL_NAME);
  });

  // RED: the manual water square is not the DESIGN themed flat tint.
  it("uses the flat themed tint, not the manual water surface", async () => {
    await renderPage();
    const avatar = screen.getByTestId("person-avatar");
    expect(avatar.className).toContain("bg-[var(--accent-soft)]");
    expect(avatar.className).toContain("text-[var(--accent-ink)]");
    expect(avatar.className).not.toContain("bg-water-soft");
    expect(avatar.className).not.toContain("text-water");
  });

  // RED: the avatar must be decorative beside the visible name, and keep the
  // 56px profile shape.
  it("is decorative beside the heading and keeps the 56px shape", async () => {
    await renderPage();
    const avatar = screen.getByTestId("person-avatar");
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(avatar.getAttribute("role")).toBeNull();
    expect(avatar.style.width).toBe("56px");
    expect(avatar.style.height).toBe("56px");
  });

  // CONTROL: the delegated role control and the staff read are unchanged.
  it("keeps the curriculum-lead control for a coach", async () => {
    await renderPage();
    const control = screen.getByTestId("curriculum-lead-control");
    expect(control.getAttribute("data-staff-id")).toBe(STAFF_ID);
    expect(getCurriculumLeadState).toHaveBeenCalled();
  });

  // CONTROL: an unknown staff id is still a 404, not an empty profile.
  it("refuses an unknown staff id", async () => {
    await expect(
      StaffDetailPage({
        params: Promise.resolve({ staffId: "33333333-3333-4333-8333-333333333333" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
