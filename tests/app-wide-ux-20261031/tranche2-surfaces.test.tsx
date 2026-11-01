// @vitest-environment jsdom
//
// Tranche 2 — the remaining surfaces (31 Oct 2026).
//
// (a) THE MEMBER DOB EDITOR. The member detail page passes
//     `type="date"` to the inline editor. The rendered control must be
//     the product's day-first field — never a browser-native date
//     input, which renders US mm/dd/yyyy segments on this locale —
//     and the committed value must be the canonical ISO date the
//     server stores.
//
// (b) RECEPTION TODAY. Five verbose full-width link cards under a huge
//     top padding is not a phone hierarchy. The entries become one
//     compact grid with purposeful copy, the comfortable target and
//     the permission gating intact, and the manual-payment
//     confirmation cue survives.
//
// (c) THE REMAINING TECHNICAL COPY. The parent link panel tells the
//     owner "Zero JavaScript" — an implementation term, not a
//     description of what the page shows. The insights preview keeps a
//     two-column grid for ONE preview, leaving half the card vacant.
//     The comparison block prints an abbreviation, its expansion and
//     the full comparison together.
//
// These assertions are about the rendered result and the user's
// reading of the page.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

type MemberPatch = { memberId: string; dateOfBirth?: string };
const updateMemberAction = vi.fn(async (input: MemberPatch) => {
  void input;
  return { ok: true, value: {} as never };
});
vi.mock("@/lib/actions/people", () => ({
  updateMemberAction: (input: MemberPatch) => updateMemberAction(input),
}));

let PERMISSIONS = new Set<string>();
let FEATURES = new Set<string>();
vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (_ctx: unknown, permission: string) => PERMISSIONS.has(permission),
  hasFeature: (_ctx: unknown, feature: string) => FEATURES.has(feature),
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireReception: async () => ({ roleKey: "reception" }),
}));
vi.mock("@/lib/actions/coach", () => ({ getTodayAction: async () => ({ sessions: [] }) }));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ overrides: {}, locale: "en" }),
}));
vi.mock("@/lib/actions/staff-attendance", () => ({
  listStaffAttendanceDayAction: async () => [],
}));
vi.mock("@/components/reception-check-ins", () => ({
  ReceptionCheckIns: () => null,
}));
vi.mock("@/components/staff-attendance-board", () => ({
  StaffAttendanceBoard: () => null,
}));

import { InlineEditField } from "@/components/member-detail/inline-edit-field";
import { ParentLinkPanel } from "@/components/parent-link-panel";
import { OwnerInsightsHome } from "@/components/owner-insights-home/owner-insights-home";
import ReceptionTodayPage from "@/app/(reception)/reception/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  PERMISSIONS = new Set();
  FEATURES = new Set();
});

describe("(a) the member date-of-birth editor", () => {
  it("uses the shared day-first field, never a native date input", () => {
    const { container } = render(
      <InlineEditField
        value=""
        field="dateOfBirth"
        memberId="m1"
        type="date"
        snapshot={{
          fullName: "Asha Rao",
          dateOfBirth: null,
          locationId: "l1",
          phone: null,
          gender: null,
          medicalNotes: null,
        }}
      />,
    );
    // Enter the editor.
    fireEvent.click(screen.getByRole("button", { name: /edit date of birth/i }));
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(0);
    const input = container.querySelector('input[inputmode="numeric"]');
    expect(input).toBeTruthy();
    expect(input?.getAttribute("placeholder")).toBe("dd/mm/yyyy");
  });

  it("commits the canonical ISO date to the server", async () => {
    render(
      <InlineEditField
        value=""
        field="dateOfBirth"
        memberId="m1"
        type="date"
        snapshot={{
          fullName: "Asha Rao",
          dateOfBirth: null,
          locationId: "l1",
          phone: null,
          gender: null,
          medicalNotes: null,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit date of birth/i }));
    const input = screen.getByLabelText("date of birth");
    fireEvent.change(input, { target: { value: "31/12/2015" } });
    await vi.waitFor(() => expect(updateMemberAction).toHaveBeenCalled());
    // The server receives the canonical ISO date, not the display form.
    expect(updateMemberAction.mock.calls[0]?.[0]).toMatchObject({
      memberId: "m1",
      dateOfBirth: "2015-12-31",
    });
  });
});

describe("(b) reception Today", () => {
  beforeEach(() => {
    PERMISSIONS = new Set([
      "attendance.mark",
      "staff.attendance",
      "payments.record",
      "invoices.read",
    ]);
    FEATURES = new Set(["billing", "cafe.pos"]);
  });

  it("lays the entries out as one compact grid, not stacked full-width cards", async () => {
    const { container } = render(await ReceptionTodayPage());
    const main = container.querySelector("main")!;
    // The top padding is compact, not the tall phone default.
    expect(main.getAttribute("class") ?? "").not.toContain("pt-10");

    const ids = [
      "collect-payment-link",
      "close-day-link",
      "dues-link",
      "member-search-link",
      "cafe-link",
    ];
    const entries = ids.map((id) => screen.getByTestId(id));
    // One grid carries the entries, so they are a set rather than five
    // stacked cards.
    const parents = new Set(entries.map((entry) => entry.parentElement));
    expect(parents.size).toBe(1);
    const grid = entries[0].parentElement!;
    expect(grid.getAttribute("class") ?? "").toMatch(/grid/);
    // Every entry keeps a comfortable target.
    for (const entry of entries) {
      expect(entry.getAttribute("class") ?? "").toMatch(/\bmin-h-\[?\d/);
    }
  });

  it("shortens the navigational prose but keeps the manual confirmation cue", async () => {
    render(await ReceptionTodayPage());
    const ids = [
      "collect-payment-link",
      "close-day-link",
      "dues-link",
      "member-search-link",
      "cafe-link",
    ];
    for (const id of ids) {
      const entry = screen.getByTestId(id);
      const paragraphs = Array.from(entry.querySelectorAll("p")).map((p) =>
        (p.textContent ?? "").trim(),
      );
      // One title line and, at most, one short description.
      expect(paragraphs.length).toBeLessThanOrEqual(2);
      for (const line of paragraphs.slice(1)) {
        expect(line.length).toBeLessThanOrEqual(60);
      }
    }
    // The manual confirmation cue survives: a payment is not confirmed
    // by a request.
    const collect = screen.getByTestId("collect-payment-link");
    expect(collect.textContent ?? "").toMatch(/verif|confirm/i);
  });

  it("keeps the permission gating", async () => {
    PERMISSIONS = new Set(["attendance.mark"]);
    FEATURES = new Set([]);
    render(await ReceptionTodayPage());
    expect(screen.queryByTestId("collect-payment-link")).toBeNull();
    expect(screen.queryByTestId("cafe-link")).toBeNull();
    // The member lookup is always offered.
    expect(screen.getByTestId("member-search-link")).toBeTruthy();
  });
});

describe("(c) the remaining technical copy", () => {
  it("does not tell the owner about JavaScript", () => {
    render(
      <ParentLinkPanel
        memberId="m1"
        memberName="Asha Rao"
        primaryGuardianName="Asha Rao"
      />,
    );
    const panel = screen.getByTestId("parent-link-panel");
    expect(panel.textContent ?? "").not.toMatch(/javascript/i);
    // The real facts stay: who it is for, and the privacy warning.
    expect(panel.textContent ?? "").toMatch(/Anyone with the link/i);
    expect(panel.textContent ?? "").toMatch(/expire/i);
  });

  it("keeps one enquiry preview without a vacant half", () => {
    const { container } = render(
      <OwnerInsightsHome
        data={
          {
            timezone: "Asia/Kolkata",
            from: "2026-10-01",
            to: "2026-10-31",
            enquiries: {
              from: "2026-10-01",
              to: "2026-10-31",
              total: 4,
              rows: [
                { stage: "new", label: "New", count: 3, share: 75 },
                { stage: "trial_booked", label: "Trial booked", count: 1, share: 25 },
              ],
            },
          } as never
        }
      />,
    );
    const preview = container.querySelector('[data-testid="owner-insights-preview"]')!;
    // ONE preview, ONE cell: no empty half of the card.
    expect(preview.children.length).toBe(1);
    // …and the area does not RESERVE a second column for it.
    expect(preview.getAttribute("class") ?? "").not.toMatch(/grid-cols-2/);
  });
});
