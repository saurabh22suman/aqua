import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const member = { memberId: "11111111-1111-4111-8111-111111111111", fullName: "Sample Member", memberCode: "M1", locationId: "a", locationName: "North", status: "active", isMinor: true, joinedOn: "2026-01-01", dateOfBirth: "2014-03-14", phone: null, gender: null, medicalNotes: null, guardians: [{ personId: "g", fullName: "Guardian", relationship: "parent", phone: null, isPrimary: true }], consents: [], statusHistory: [] };
vi.mock("next/navigation", () => ({ usePathname: () => "/owner/members/11111111-1111-4111-8111-111111111111", useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "t", userId: "u" }) }));
vi.mock("@/lib/auth/permission", () => ({ hasFeature: () => false, hasPermission: () => true }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ isLiveOwnerForSettings: async () => true }));
vi.mock("@/lib/actions/people", () => ({ getMemberDetailAction: async () => member, getMemberIdCardContextAction: async () => null, listLocationsAction: async () => [], updateMemberAction: vi.fn(), transitionMemberStatusAction: vi.fn(), getMemberPayerAction: vi.fn() }));
vi.mock("@/lib/actions/attendance", () => ({ getMemberAttendanceHistoryAction: async () => ({ rows: [], today: "2026-11-16" }) }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/lib/actions/facility-optins", () => ({ listOptedFacilitiesAction: async () => [] }));
vi.mock("@/lib/actions/notification-destinations", () => ({ getNotificationDestinationsAction: async () => ({ contacts: [], communicationsAllowed: false, minor: true }), saveNotificationDestinationsAction: vi.fn() }));
vi.mock("@/lib/actions/invoices", () => ({ listMemberInvoicesAction: async () => [] }));
vi.mock("@/components/member-detail/owner-member-initial-panels", () => ({ readOwnerMemberInitialPanels: async () => ({ enrolment: { memberId: member.memberId, enrolments: [], batches: [] }, subscription: { memberId: member.memberId, subscriptions: [], plans: [] }, makeup: { memberId: member.memberId, failed: true } }) }));
import MemberDetailPage from "@/app/(owner)/owner/members/[memberId]/page";

describe("owner member overview", () => {
  it("presents separate summary cards and facts before task editors", async () => {
    const html = renderToStaticMarkup(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    for (const label of ["Participation", "Membership plan", "Outstanding", "Personal details", "Family and contact", "Attendance", "Edit details"]) expect(html).toContain(label);
    expect(html.indexOf("Attendance")).toBeLessThan(html.indexOf("Manage membership"));
    expect(html).toContain("14 Mar 2014");
    for (const tab of ["Overview", "Fees", "Progress", "More", "Notes"]) expect(html).toContain(tab);
    expect(html).not.toContain('tab=documents');
  });
});
