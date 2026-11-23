// @vitest-environment jsdom
import Link from "next/link";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CoachRosterSearch } from "@/components/coach-roster-search";
import { FeesSummaryMetrics } from "@/components/fees/fees-summary-metrics";
import { SelfHome } from "@/components/self-home";
import OwnerInvoicePage from "@/app/(owner)/owner/invoices/[invoiceId]/page";
import ReceptionMemberDetailPage from "@/app/(reception)/reception/members/[memberId]/page";

const memberId = "00000000-0000-4000-8000-000000000123";
const ownerContext = { tenantId: "club", userId: "owner" };
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ownerContext,
  requireReception: async () => ({ tenantId: "club", userId: "reception" }),
  requirePagePermission: vi.fn(),
}));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: () => true }));
vi.mock("@/lib/actions/invoices", () => ({
  getInvoiceAction: async () => ({
    id: "invoice-1", invoiceNumber: "INV-1", payerName: "Leela Prabhu", locationName: "North", locationId: "club-north",
  }),
}));
vi.mock("@/components/fees/invoice-detail-surface", () => ({
  InvoiceDetailSurface: () => <p>Authorized invoice detail</p>,
}));
vi.mock("@/lib/actions/people", () => ({
  getMemberDetailAction: async () => ({
    memberId, fullName: "Leela Prabhu", memberCode: "LP-2", locationName: "North", isMinor: true,
    guardians: [], consents: [],
  }),
  getMemberIdCardContextAction: async () => null,
}));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/lib/actions/notification-destinations", () => ({ getNotificationDestinationsAction: async () => null }));
vi.mock("@/components/member-enrolment-panel", () => ({ MemberEnrolmentPanel: () => <h2>Batch enrolments</h2> }));
vi.mock("@/components/member-subscription-panel", () => ({ MemberSubscriptionPanel: () => <h2>Plans and subscriptions</h2> }));
vi.mock("@/components/member-detail/member-invoices-panel", () => ({ MemberInvoicesPanel: () => <p>Invoice controls</p> }));
vi.mock("@/components/reception/member-search-navigation", () => ({ BackToReceptionSearch: () => <Link href="/reception/members">Back to member search</Link> }));

afterEach(cleanup);

it("groups overdue within today's outstanding balance and opens exactly that scoped queue", () => {
  const period = { from: "2026-11-01", to: "2026-12-01" };
  render(<FeesSummaryMetrics period={period} facility="club-north" overview={{
    ...period, today: "2026-11-21", collectedPaise: 55250, paymentCount: 2, reversalCount: 0, reversedPaise: 0,
    outstandingPaise: 518525, overduePaise: 417500, dueInvoiceCount: 4, overdueInvoiceCount: 3, overdueAgeing: [],
  }} />);
  const balances = screen.getByRole("group", { name: "Current balances" });
  expect(within(balances).getByText("₹5,185")).toBeTruthy();
  const exactBalances = within(balances).getByText("Exact balances").closest("details")!;
  expect(within(exactBalances).getByText("₹5,185.25")).toBeTruthy();
  const late = within(balances).getByRole("link", { name: "View overdue invoices" });
  const query = new URL(late.getAttribute("href")!, "https://example.test").searchParams;
  expect([query.get("tab"), query.get("overdue"), query.get("facility"), query.get("from"), query.get("to")])
    .toEqual(["dues", "1", "club-north", period.from, period.to]);
});

it("returns from the standalone invoice to its authorized club's invoice ledger", async () => {
  render(await OwnerInvoicePage({ params: Promise.resolve({ invoiceId: "invoice-1" }) }));
  const back = screen.getByRole("link", { name: "Invoice ledger" });
  const query = new URL(back.getAttribute("href")!, "https://example.test").searchParams;
  expect([query.get("tab"), query.get("facility")]).toEqual(["invoices", "club-north"]);
  expect(screen.getByText("Authorized invoice detail")).toBeTruthy();
});

it("puts direct desk actions under the member identity and links to the real controls", async () => {
  render(await ReceptionMemberDetailPage({ params: Promise.resolve({ memberId }) }));
  expect(screen.getByRole("heading", { level: 1, name: "Leela Prabhu" })).toBeTruthy();
  const nav = screen.getByRole("navigation", { name: "Member tasks" });
  for (const [label, sectionTitle] of [["Invoices and payments", "Invoices and payments"], ["Batch enrolment", "Batch enrolments"], ["Membership plans", "Plans and subscriptions"]]) {
    const anchor = within(nav).getByRole("link", { name: label }).getAttribute("href")!;
    expect(document.getElementById(anchor.slice(1))?.contains(screen.getByRole("heading", { name: sectionTitle }))).toBe(true);
  }
});

it("combines an exact batch filter with a code search and clears both from the empty state", () => {
  render(<CoachRosterSearch roster={[
    { memberId: "1", name: "Saira Rao", code: "AC-100", isMinor: false, batches: ["Junior"] },
    { memberId: "2", name: "Myra Shah", code: "AC-200", isMinor: true, batches: ["Junior Advanced"] },
  ]} memberNouns="swimmers" />);
  const batch = screen.getByLabelText("Batch");
  const search = screen.getByRole("searchbox", { name: "Search swimmers" });
  fireEvent.change(batch, { target: { value: "Junior" } });
  expect(screen.getAllByTestId("coach-roster-row")).toHaveLength(1);
  expect(screen.queryByText("Myra Shah")).toBeNull();
  fireEvent.change(search, { target: { value: "AC-200" } });
  expect(screen.queryByTestId("coach-roster-row")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getAllByTestId("coach-roster-row")).toHaveLength(2);
});

it("gives a family with two same-name members an index that points to the correct membership", () => {
  render(<SelfHome audience="guardian" scopeKind="self_session" tenantId="club" view={{
    clubName: "Test Club", audience: "guardian", entries: [
      { memberId: "child-a", fullName: "Alex", memberCode: "A-1", status: "active", facilityName: "North" },
      { memberId: "child-b", fullName: "Alex", memberCode: "B-2", status: "active", facilityName: "South" },
    ],
  }} />);
  const list = screen.getByRole("navigation", { name: "Choose a membership" });
  const choice = within(list).getByRole("link", { name: /Alex.*B-2/ });
  const target = document.getElementById(choice.getAttribute("href")!.slice(1));
  expect(target?.textContent).toContain("Member code B-2");
  expect(target?.querySelector('a[href="/family/billing/child-b"]')).toBeTruthy();
  expect(target?.querySelector('a[href="/family/billing/child-a"]')).toBeNull();
});
