// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
const member = { memberId: "11111111-1111-4111-8111-111111111111", personId: "person-1", fullName: "Sample Member", memberCode: "M1", locationId: "a", locationName: "North", status: "active", isMinor: true, joinedOn: "2026-01-01", dateOfBirth: "2014-03-14", phone: null, gender: null, medicalNotes: null, guardians: [{ personId: "g", fullName: "Guardian", relationship: "parent", phone: null, isPrimary: true }], consents: [], statusHistory: [] };
const state = vi.hoisted(() => ({ failed: false, write: true, programs: true, update: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/owner/members/11111111-1111-4111-8111-111111111111", useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "t", userId: "u" }) }));
vi.mock("@/lib/auth/permission", () => ({ hasFeature: () => false, hasPermission: (_ctx: unknown, permission: string) => permission === "members.write" ? state.write : permission === "programs.read" ? state.programs : true }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ isLiveOwnerForSettings: async () => true }));
vi.mock("@/lib/actions/people", () => ({ getMemberDetailAction: async () => member, getMemberIdCardContextAction: async () => null, listLocationsAction: async () => [], updateMemberAction: state.update, transitionMemberStatusAction: vi.fn(), getMemberPayerAction: vi.fn() }));
vi.mock("@/lib/actions/attendance", () => ({ getMemberAttendanceHistoryAction: async () => ({ rows: [], today: "2026-11-16" }) }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/lib/actions/facility-optins", () => ({ listOptedFacilitiesAction: async () => [] }));
vi.mock("@/lib/actions/notification-destinations", () => ({ getNotificationDestinationsAction: async () => ({ contacts: [], communicationsAllowed: false, minor: true }), saveNotificationDestinationsAction: vi.fn() }));
vi.mock("@/lib/actions/invoices", () => ({ listMemberInvoicesAction: async () => [] }));
vi.mock("@/components/member-detail/owner-member-initial-panels", () => ({ readOwnerMemberInitialPanels: async () => ({ enrolment: state.failed ? { memberId: member.memberId, failed: true } : { memberId: member.memberId, enrolments: [{ batchId: "b", batchName: "Evening", programName: "Junior", enrolledOn: "2026-01-01" }, { batchId: "c", batchName: "Evening", programName: "Junior", enrolledOn: "2026-01-01" }, { batchId: "missing", batchName: "Other", programName: "Junior", enrolledOn: "2026-01-01" }, { batchId: "wide", batchName: "Open", programName: "Junior", enrolledOn: "2026-01-01" }], batches: [{ id: "b", locationId: "a", locationName: "North" }, { id: "c", locationId: "c", locationName: "South" }, { id: "wide", locationId: null, locationName: null }] }, subscription: { memberId: member.memberId, subscriptions: [], plans: [] }, makeup: { memberId: member.memberId, failed: true } }) }));
import MemberDetailPage from "@/app/(owner)/owner/members/[memberId]/page";
afterEach(() => { cleanup(); state.failed = false; state.write = true; state.programs = true; state.update.mockReset(); });

describe("member overview polish", () => {
  it("renders batch names as their own elements with matched facility metadata", async () => {
    render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    const section = screen.getByRole("region", { name: "Batches" });
    const rows = within(section).getAllByRole("listitem");
    expect(within(rows[0]).getByText("Evening", { exact: true })).toBeTruthy();
    expect(within(rows[0]).getByText("Junior", { exact: true })).toBeTruthy();
    expect(within(rows[0]).getByText("North", { exact: true })).toBeTruthy();
    expect(within(rows[1]).getByText("South", { exact: true })).toBeTruthy();
  });
  it("offers a single named add control without a faux add value", async () => {
    render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    expect(screen.getByRole("button", { name: "Add phone" })).toBeTruthy();
    expect(screen.queryByText("Add phone", { selector: "span" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit phone" })).toBeNull();
  });
  it("keeps management gated and hides facility metadata without program permission", async () => {
    state.programs = false;
    render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    const section = screen.getByRole("region", { name: "Batches" });
    expect(within(section).queryByText("North", { exact: true })).toBeNull();
    expect(within(section).queryByText("South", { exact: true })).toBeNull();
    expect(within(section).queryByRole("button", { name: "Manage batches" })).toBeNull();
  });
  it("shows formatted values without edit controls for read-only members", async () => {
    state.write = false;
    render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    const section = screen.getByRole("region", { name: "Personal details" });
    expect(within(section).getByText("14 Mar 2014")).toBeTruthy();
    expect(within(section).getAllByText("Not provided").length).toBeGreaterThan(0);
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Manage batches" })).toBeNull();
  });
  it("opens and focuses the existing enrolment management target", async () => {
    render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    fireEvent.click(screen.getByRole("button", { name: "Manage batches" }));
    expect((document.getElementById("member-management") as HTMLDetailsElement).open).toBe(true);
    expect(document.activeElement).toBe(document.getElementById("member-management-enrolment"));
  });
  it("preserves explicit save, pending, error, retry and field-scoped payload", async () => {
    let resolve!: (v: unknown) => void;
    state.update.mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValueOnce({ ok: true, value: { phone: "9876543210" } });
    render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    fireEvent.click(screen.getByRole("button", { name: "Add phone" }));
    const input = screen.getByLabelText("phone number");
    fireEvent.change(input, { target: { value: "9876543210" } });
    fireEvent.blur(input);
    expect(state.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);
    await waitFor(() => expect(state.update).toHaveBeenCalledWith({ memberId: member.memberId, phone: "9876543210" }));
    await act(async () => resolve({ ok: false, error: "Try again" }));
    expect(screen.getByRole("alert").textContent).toBe("Try again");
    expect(input).toHaveProperty("value", "9876543210");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit phone" })).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit phone" }));
  });
  it("cancels with Escape and returns focus without saving", async () => {
    render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Draft" } });
    fireEvent.keyDown(screen.getByLabelText("name"), { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit name" }));
    expect(state.update).not.toHaveBeenCalled();
  });

});
