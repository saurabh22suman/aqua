// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
const member = { memberId: "11111111-1111-4111-8111-111111111111", personId: "person-1", fullName: "Sample Member", memberCode: "M1", locationId: "a", locationName: "North", status: "active", isMinor: true, joinedOn: "2026-01-01", dateOfBirth: "2014-03-14", phone: null, gender: null, medicalNotes: null, guardians: [{ personId: "g", fullName: "Guardian", relationship: "parent", phone: null, isPrimary: true }], consents: [], statusHistory: [] };
const state = vi.hoisted(() => ({ failed: false, write: true, programs: true, update: vi.fn(), loads: vi.fn(), reads: vi.fn(), grant: true, redeem: true }));
vi.mock("next/navigation", () => ({ usePathname: () => "/owner/members/11111111-1111-4111-8111-111111111111", useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "t", userId: "u" }) }));
vi.mock("@/lib/auth/permission", () => ({ hasFeature: () => false, hasPermission: (_ctx: unknown, permission: string) => permission === "members.write" ? state.write : permission === "programs.read" ? state.programs : permission === "programs.write" ? state.grant : permission === "attendance.mark" ? state.redeem : true }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ isLiveOwnerForSettings: async () => true }));
vi.mock("@/lib/actions/people", () => ({ getMemberDetailAction: async () => member, getMemberIdCardContextAction: async () => ({ tenantSlug: "club", displayName: "Club", accent: "mint", initials: "C" }), listLocationsAction: async () => [], updateMemberAction: state.update, transitionMemberStatusAction: vi.fn(), getMemberPayerAction: vi.fn() }));
vi.mock("@/lib/actions/attendance", () => ({ getMemberAttendanceHistoryAction: async () => ({ rows: [], today: "2026-11-16" }) }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/lib/actions/facility-optins", () => ({ listOptedFacilitiesAction: async () => [] }));
vi.mock("@/lib/actions/notification-destinations", () => ({ getNotificationDestinationsAction: async () => ({ contacts: [], communicationsAllowed: false, minor: true }), saveNotificationDestinationsAction: vi.fn() }));
vi.mock("@/lib/actions/invoices", () => ({ listMemberInvoicesAction: async () => [] }));
vi.mock("@/components/member-detail/owner-member-initial-panels", () => ({ readOwnerMemberInitialPanels: async () => ({ enrolment: state.failed ? { memberId: member.memberId, failed: true } : { memberId: member.memberId, enrolments: [{ batchId: "b", batchName: "Evening", programName: "Junior", enrolledOn: "2026-01-01" }, { batchId: "c", batchName: "Evening", programName: "Junior", enrolledOn: "2026-01-01" }, { batchId: "missing", batchName: "Other", programName: "Junior", enrolledOn: "2026-01-01" }, { batchId: "wide", batchName: "Open", programName: "Junior", enrolledOn: "2026-01-01" }], batches: [{ id: "b", locationId: "a", locationName: "North" }, { id: "c", locationId: "c", locationName: "South" }, { id: "wide", locationId: null, locationName: null }] }, subscription: { memberId: member.memberId, subscriptions: [], plans: [] }, makeup: { memberId: member.memberId, credits: [{ creditId: "c1", sourceSessionId: "s1", sourceDate: "2026-09-05", status: "granted", expiresAt: "2026-11-04T00:00:00.000Z" }], sources: [{ sessionId: "s2", sessionDate: "2026-09-07", batchName: "Junior" }, { sessionId: "s4", sessionDate: "2026-09-08", batchName: "Advanced" }], targets: [{ sessionId: "s3", sessionDate: "2026-09-15", batchName: "Evening" }, { sessionId: "s5", sessionDate: "2026-09-16", batchName: "Morning" }] } }) }));

vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return { default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
    const Lazy = React.lazy(async () => { state.loads(); return { default: await loader() }; });
    return function Dynamic(props: Record<string, unknown>) { return <React.Suspense fallback={<span>Loading</span>}><Lazy {...props} /></React.Suspense>; };
  } };
});
vi.mock("@/lib/actions/makeup", () => ({ listMakeupCreditsAction: state.reads, listMakeupSourcesAction: state.reads, listMakeupTargetsAction: state.reads, grantMakeupCreditAction: vi.fn(), redeemMakeupCreditAction: vi.fn() }));
vi.mock("@/components/member-id-card", () => ({ MemberIdCard: () => <p>Server card retained</p> }));
import MemberDetailPage from "@/app/(owner)/owner/members/[memberId]/page";
afterEach(() => { cleanup(); state.reads.mockReset(); state.grant = true; state.redeem = true; });

it("does not load the module or fetch makeup while Other member tools is closed", async () => {
  const loadsBeforeRender = state.loads.mock.calls.length;
  render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
  expect(state.reads).not.toHaveBeenCalled();
  expect(state.loads).toHaveBeenCalledTimes(loadsBeforeRender);
  expect(screen.queryByText("Makeup credits")).toBeNull();
  expect(screen.getByText("Other member tools").closest("details")?.textContent).toContain("Server card retained");
});

it("shows seeded credit read-only without client reads or mutation controls", async () => {
  state.grant = false;
  state.redeem = false;
  render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
  const disclosure = screen.getByText("Other member tools").closest("details")!;
  disclosure.open = true;
  fireEvent(disclosure, new Event("toggle"));
  expect(await screen.findByText("5 Sept 2026", { exact: true })).toBeTruthy();
  expect(state.reads).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /grant credit/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /redeem/i })).toBeNull();
});

it("preserves seeded source and target selections when closed and reopened", async () => {
  render(await MemberDetailPage({ params: Promise.resolve({ memberId: member.memberId }) }));
  const disclosure = screen.getByText("Other member tools").closest("details")!;
  disclosure.open = true;
  fireEvent(disclosure, new Event("toggle"));
  const source = await screen.findByTestId("makeup-source");
  const target = screen.getByTestId("makeup-target");
  fireEvent.change(source, { target: { value: "s4" } });
  fireEvent.change(target, { target: { value: "s5" } });
  disclosure.open = false;
  fireEvent(disclosure, new Event("toggle"));
  disclosure.open = true;
  fireEvent(disclosure, new Event("toggle"));
  expect(screen.getByTestId("makeup-source")).toHaveProperty("value", "s4");
  expect(screen.getByTestId("makeup-target")).toHaveProperty("value", "s5");
  expect(state.reads).not.toHaveBeenCalled();
});
