// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// F13 — the normal owner member profile must carry the shared, 44px back link
// to the resolved member-list route. The accountant finance view keeps its own
// existing BackLink and is not rendered here.

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/actions/people", () => ({
  getMemberDetailAction: async () => ({
    memberId: "11111111-1111-4111-8111-111111111111",
    fullName: "Aanya Rao",
    phone: null,
    memberCode: "AAC-001",
    locationId: "loc-1",
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
  }),
  getMemberIdCardContextAction: async () => null,
  getMemberPayerAction: async () => null,
  listLocationsAction: async () => [],
}));
vi.mock("@/lib/actions/attendance", () => ({
  getMemberAttendanceHistoryAction: async () => ({ rows: [], today: "2026-10-29" }),
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({
    overrides: { member: { en: { one: "swimmer", other: "swimmers" } } },
    locale: "en",
  }),
}));
vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));
vi.mock("@/lib/actions/facility-optins", () => ({
  listOptedFacilitiesAction: async () => [],
}));
vi.mock("@/lib/actions/notification-destinations", () => ({
  getNotificationDestinationsAction: async () => null,
}));
vi.mock("@/lib/actions/assessments", () => ({
  getMemberProgressAction: async () => null,
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({ permissions: new Set() }),
}));
vi.mock("@/lib/auth/permission", () => ({
  hasPermission: () => false,
  hasFeature: () => false,
}));
vi.mock("@/lib/params", () => ({ requireUuidParam: () => undefined }));

const Empty = vi.hoisted(() => () => null);
vi.mock("@/components/member-status-panel", () => ({ MemberStatusPanel: Empty }));
vi.mock("@/components/member-enrolment-panel", () => ({ MemberEnrolmentPanel: Empty }));
vi.mock("@/components/member-subscription-panel", () => ({ MemberSubscriptionPanel: Empty }));
vi.mock("@/components/member-facilities-panel", () => ({ MemberFacilitiesPanel: Empty }));
vi.mock("@/components/makeup-credits-panel", () => ({ MakeupCreditsPanel: Empty }));
vi.mock("@/components/parent-link-panel", () => ({ ParentLinkPanel: Empty }));
vi.mock("@/components/member-id-card", () => ({ MemberIdCard: Empty }));
vi.mock("@/components/member-notification-destinations", () => ({
  MemberNotificationDestinations: Empty,
}));
vi.mock("@/components/member-detail/member-detail-tabs", () => ({
  MemberDetailTabs: Empty,
}));
vi.mock("@/components/member-detail/member-profile-sections", () => ({
  MemberProfileSections: Empty,
}));
vi.mock("@/components/member-detail/member-attendance-grid", () => ({
  MemberAttendanceGrid: Empty,
}));
vi.mock("@/components/member-detail/member-invoices-panel", () => ({
  MemberInvoicesPanel: Empty,
}));
vi.mock("@/components/member-detail/member-progress-panel", () => ({
  MemberProgressPanel: Empty,
}));
vi.mock("@/components/member-detail/member-notes-panel", () => ({
  MemberNotesPanel: Empty,
}));
vi.mock("@/components/member-detail/member-documents-panel", () => ({
  MemberDocumentsPanel: Empty,
}));
vi.mock("@/components/member-detail/inline-edit-field", () => ({
  InlineEditField: ({ value }: { value: string }) => <>{value}</>,
}));

import MemberDetailPage from "@/app/(owner)/owner/members/[memberId]/page";

afterEach(cleanup);

describe("owner member profile back link", () => {
  it("returns to the resolved owner member list with the shared 44px control", async () => {
    render(
      await MemberDetailPage({
        params: Promise.resolve({ memberId: "11111111-1111-4111-8111-111111111111" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const back = screen.getByRole("link", { name: "Swimmers" });
    expect(back.getAttribute("href")).toBe("/owner/members");
    expect(back.className).toContain("min-h-11");
    expect(screen.getByRole("heading", { name: /Aanya Rao/ })).toBeTruthy();
  });
});
