// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { resolveTerm } from "@/lib/terminology/keys";

const state = vi.hoisted(() => ({
  terminology: {
    locale: "en" as const,
    overrides: {
      member: { en: { one: "swimmer", other: "swimmers" } },
      guardian: { en: { one: "carer", other: "carers" } },
      session: { en: { one: "swim lesson", other: "swim lessons" } },
    },
  },
}));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => state.terminology }));
vi.mock("@/lib/actions/coach", () => ({ getTodayAction: async () => ({ sessions: [] }), getCoachRosterAction: async () => [] }));
vi.mock("@/lib/actions/people", () => ({ listMembersAction: async () => [], listLocationsAction: async () => [] }));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireReception: async () => ({ tenantId: "tenant", userId: "user", roleKey: "receptionist", permissions: new Set(["members.write"]), features: new Set() }),
  requireCoach: async () => ({}),
}));
vi.mock("@/components/reception-check-ins", () => ({ ReceptionCheckIns: () => null }));
vi.mock("@/components/staff-attendance-board", () => ({ StaffAttendanceBoard: () => null }));
vi.mock("@/components/onboarding/optional-workspace-guide", () => ({ OptionalWorkspaceGuide: () => null }));
vi.mock("@/components/coach-roster-search", () => ({ CoachRosterSearch: () => null }));
vi.mock("@/components/member-create-form", () => ({ MemberCreateForm: ({ terminology }: { terminology: import("@/lib/terminology/keys").TerminologyState }) => <div>Form: {resolveTerm(terminology, "member", "other")} / {resolveTerm(terminology, "guardian", "other")}</div> }));

import ReceptionTodayPage from "@/app/(reception)/reception/page";
import ReceptionMembersPage from "@/app/(reception)/reception/members/page";
import ReceptionNewMemberPage from "@/app/(reception)/reception/members/new/page";
import CoachMembersPage from "@/app/(coach)/coach/members/page";
import { StaffClubContext } from "@/components/staff-ui/staff-club-context";

afterEach(cleanup);

it("labels reception Today and member search consistently despite a swimming override", async () => {
  render(await ReceptionTodayPage());
  expect(screen.getByTestId("member-search-link").textContent).toContain("Find a member");
  cleanup();
  render(await ReceptionMembersPage({}));
  expect(screen.getByRole("heading", { name: "Find a member" })).toBeTruthy();
  expect(screen.getByLabelText("Search members")).toBeTruthy();
});

it("uses default core plurals for the coach roster", async () => {
  render(await CoachMembersPage());
  expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy();
  expect(screen.getByText("No members in your batches yet")).toBeTruthy();
});

it("keeps non-core overrides while presenting neutral core terms in the reception form", async () => {
  render(await ReceptionNewMemberPage());
  expect(screen.getByRole("heading", { name: "Add member" })).toBeTruthy();
  expect(screen.getByText("Form: members / carers")).toBeTruthy();
  expect(resolveTerm(state.terminology, "member", 1)).toBe("swimmer");
});

it.each([
  ["All clubs", "All clubs"],
  ["No assigned clubs", "No assigned clubs"],
  ["2 assigned clubs", "2 assigned clubs"],
  ["North Club", "North Club"],
])("identifies the business and renders the club scope %s", (siteLabel, expected) => {
  render(<StaffClubContext clubName="Example Business" roleLabel="receptionist" siteLabel={siteLabel} />);
  expect(screen.getByLabelText("Business: Example Business")).toBeTruthy();
  expect(screen.getByText(new RegExp(expected))).toBeTruthy();
});
