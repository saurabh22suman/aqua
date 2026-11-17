// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const member = { memberId: "11111111-1111-4111-8111-111111111111", personId: "person-1", fullName: "Sample Member", memberCode: "M1", locationId: "a", locationName: "North", status: "active", isMinor: true, joinedOn: "2026-01-01", dateOfBirth: "2014-03-14", phone: null, gender: null, medicalNotes: null, guardians: [{ personId: "g", fullName: "Guardian", relationship: "parent", phone: null, isPrimary: true }], consents: [], statusHistory: [] };
const state = vi.hoisted(() => ({ failed: false }));
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
vi.mock("@/components/member-detail/owner-member-initial-panels", () => ({ readOwnerMemberInitialPanels: async () => ({ enrolment: state.failed ? { memberId: member.memberId, failed: true } : { memberId: member.memberId, enrolments: [{ batchId: "b", batchName: "Evening", programName: "Junior", enrolledOn: "2026-01-01" }, { batchId: "c", batchName: "Evening", programName: "Junior", enrolledOn: "2026-01-01" }, { batchId: "missing", batchName: "Other", programName: "Junior", enrolledOn: "2026-01-01" }, { batchId: "wide", batchName: "Open", programName: "Junior", enrolledOn: "2026-01-01" }], batches: [{ id: "b", locationId: "a", locationName: "North" }, { id: "c", locationId: "c", locationName: "South" }, { id: "wide", locationId: null, locationName: null }] }, subscription: { memberId: member.memberId, subscriptions: [], plans: [] }, makeup: { memberId: member.memberId, failed: true } }) }));
import MemberDetailPage from "@/app/(owner)/owner/members/[memberId]/page";
import { OwnerMemberSummary } from "@/components/member-detail/owner-member-summary";
afterEach(() => { cleanup(); state.failed = false; });

describe("owner member overview", () => {
  it("summarises the real batch before the management disclosure, without inventing attendance", async () => {
    const html = renderToStaticMarkup(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    for (const label of ["Participation", "Membership plan", "Outstanding", "Personal details", "Family and contact", "Attendance", "Edit details"]) expect(html).toContain(label);
    expect(html.indexOf("Attendance")).toBeLessThan(html.indexOf("Manage membership"));
    const { container } = render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    const batches = within(screen.getByRole("region", { name: "Batches" })).getAllByRole("listitem");
    for (const [index, name, facility] of [[0, "Evening", "North"], [1, "Evening", "South"], [2, "Other", "Facility unavailable"], [3, "Open", "Club-wide"]] as const) {
      expect(within(batches[index]).getByText(name, { exact: true })).toBeTruthy();
      expect(within(batches[index]).getByText("Junior", { exact: true })).toBeTruthy();
      expect(within(batches[index]).getByText(facility, { exact: true })).toBeTruthy();
    }
    expect(container.textContent!.indexOf("Evening")).toBeLessThan(container.textContent!.indexOf("Manage membership"));
    expect(html.indexOf("Attendance")).toBeLessThan(html.indexOf("Personal details"));
    expect(container.textContent!.indexOf("Evening")).toBeLessThan(container.textContent!.indexOf("Personal details"));
    expect(html.indexOf("Personal details")).toBeLessThan(html.indexOf("Family and contact"));
    expect(html).toContain("No sessions marked yet");
    expect(html).toContain('data-avatar-seed="person-1"');
    expect(html).toContain("14 Mar 2014");
    for (const tab of ["Overview", "Fees", "Progress", "Notes"]) expect(html).toContain(tab);
    expect(html).not.toContain('tab=documents');
  });

  it("opens the membership disclosure at the chosen task and focuses it", async () => {
    render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    fireEvent.click(screen.getByRole("button", { name: "Manage batches" }));
    const disclosure = screen.getByText("Manage membership").closest("details")!;
    expect(disclosure.open).toBe(true);
    expect(document.activeElement?.textContent).toContain("Enrolment");
    fireEvent.click(screen.getByRole("button", { name: "Manage plan" }));
    expect(document.activeElement?.textContent).toContain("Membership plan");
    fireEvent.click(screen.getByRole("button", { name: "Manage participation" }));
    expect(document.activeElement?.textContent).toContain("Participation management");
    expect(document.activeElement?.querySelector("details")?.open).toBe(true);
    expect(screen.getByRole("link", { name: "View invoices" }).getAttribute("href")).toContain("tab=payments&facility=all");
  });

  it("does not offer unauthorized management or invent unavailable amounts", () => {
    render(<OwnerMemberSummary status="paused" plans={null} balance={null} canManage={false} />);
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Manage/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "View invoices" })).toBeNull();
  });

  it("opens the real retry control when the initial enrolment read fails", async () => {
    state.failed = true;
    render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    expect(screen.getByText("Batch information is unavailable.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage batches" }));
    expect(within(document.getElementById("member-management-enrolment")!).getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
