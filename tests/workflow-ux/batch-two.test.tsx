// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BookingRowActions } from "@/components/booking-day-list";
import type { BookingDayRow } from "@/lib/services/bookings";
import { AnnouncementComposer } from "@/components/announcements/announcement-composer";
import { SelfInboxPage } from "@/components/announcements/self-inbox-page";
import ReceptionDuesPage from "@/app/(reception)/reception/dues/page";
import { GET as signedParent } from "@/app/p/[token]/route";

const mocked = vi.hoisted(() => ({ preview: vi.fn(), send: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: vi.fn() }));
vi.mock("@/lib/actions/announcements", () => ({ sendAnnouncementAction: mocked.send, previewAnnouncementAudienceAction: mocked.preview }));
vi.mock("@/lib/auth/self-scope", () => ({ resolveSelfScope: async () => ({ read: async () => [
  { id: "first", title: "Weekend training", body: "Use the west gate.", createdAt: "2026-11-20T12:00Z", readAt: null },
  { id: "second", title: "Earlier timetable", body: "November dates.", createdAt: "2026-11-19T12:00Z", readAt: "2026-11-19T13:00Z" },
] }) }));
vi.mock("@/lib/services/announcements", () => ({ readSelfNotificationsInTx: vi.fn() }));
vi.mock("@/lib/actions/self-notifications", () => ({ markSelfNotificationAction: vi.fn() }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireReception: async () => ({}) }));
vi.mock("@/lib/auth/permission", () => ({ hasFeature: () => true, hasPermission: () => true }));
vi.mock("@/lib/actions/fees-hub", () => ({ listDeskDuesAction: async () => [
  { id: "i1", invoiceNumber: "NOV-01", payerName: "Anika Joshi", memberCode: "A1", phone: null, dueOn: "2026-11-16", outstandingPaise: 56000, overdue: true },
  { id: "i2", invoiceNumber: "NOV-02", payerName: "Ved Joshi", memberCode: "A2", phone: null, dueOn: "2026-11-27", outstandingPaise: 61000, overdue: false },
] }));
vi.mock("@/lib/services/parent-link", () => ({ verifyParentLinkToken: () => ({ tenantId: "tenant", personId: "child" }) }));
vi.mock("@/lib/services/branding", () => ({ getBranding: async () => ({ accent: "marine", displayName: "Worli Club", shortName: "WC" }) }));
vi.mock("@/lib/services/terminology", () => ({ getTerminology: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/lib/services/attendance-history", () => ({ currentMonthPeriod: () => ({ from: "2026-11-01", to: "2026-11-30" }) }));
vi.mock("@/lib/services/parent-view", () => ({
  parentAlertLine: vi.fn(),
  getParentViewData: async () => ({
    child: { fullName: "Anika Joshi", memberCode: "A1" }, nextSession: null,
    attendance: { pct: null, presentCount: 0, totalCount: 0, recent: [] },
    fees: { outstanding: [], payments: [
      { id: "p1", receivedAt: "2026-11-20T12:00Z", amountPaise: 7567, method: "cash", invoiceNumber: "NOV-01" },
      { id: "p2", receivedAt: "2026-11-19T12:00Z", amountPaise: 5000, method: "cash", invoiceNumber: null },
    ] },
  }),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });
const booking: BookingDayRow = {
  bookingId: "b1", facilityId: "f1", facilityName: "Court 1", subUnitId: null, subUnitName: null,
  locationId: "l", locationName: "Worli", memberId: null, memberName: null, walkInName: "Rohan Mehta",
  startsAt: "2026-11-21T08:30:00Z", endsAt: "2026-11-21T09:30:00Z", status: "confirmed", pricePaise: 50000,
  invoiceId: "invoice", invoiceNumber: "VOID-01", invoiceStatus: "void", amountDuePaise: 0, billable: true,
};

it("confirms the exact active booking before cancellation and labels a voided bill as replaceable", () => {
  const onCancel = vi.fn();
  const permissions = { canCancel: true, canBill: true };
  const view = render(<BookingRowActions row={booking} busyId={null} onCancel={onCancel} onBill={vi.fn()} {...permissions} />);
  fireEvent.click(screen.getByTestId("booking-cancel-button"));
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.getByText(/Rohan Mehta.*Court 1/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  expect(onCancel).toHaveBeenCalledWith(booking);
  expect(screen.getByRole("button", { name: "Request replacement bill" })).toBeTruthy();
  view.rerender(<BookingRowActions row={{ ...booking, status: "completed" }} busyId={null} onCancel={onCancel} onBill={vi.fn()} {...permissions} />);
  expect(screen.queryByTestId("booking-cancel-button")).toBeNull();
});

it("filters the scoped dues list by the exact invoice number without losing its payment link", async () => {
  render(await ReceptionDuesPage());
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a due invoice" }), { target: { value: "NOV-02" } });
  expect(screen.queryByText("Anika Joshi")).toBeNull();
  expect(screen.getByRole("link", { name: /Collect payment for Ved Joshi/ }).getAttribute("href")).toBe("/reception/collect-payment?invoice=i2");
  fireEvent.click(screen.getByRole("button", { name: /^Overdue/ }));
  expect(screen.getByText(/No invoices match/)).toBeTruthy();
});

it("shows the supported invoice identifiers outside the search field", async () => {
  render(await ReceptionDuesPage());
  const search = screen.getByRole("searchbox", { name: "Find a due invoice" });
  const help = screen.getByText("Name, invoice number, code or phone");
  expect(search.getAttribute("aria-describedby")).toBe(help.id);
});

it("does not offer academy-wide audiences to a batch-only sender", () => {
  const grants = { canSendClubWide: false };
  render(<AnnouncementComposer batches={[{ id: "b", name: "Junior" }]} memberLabel="Members" batchLabel="Batch" guardianLabel="Guardians" {...grants} />);
  expect(screen.queryByRole("option", { name: "Everyone" })).toBeNull();
  expect(screen.queryByRole("option", { name: /Parents/ })).toBeNull();
  expect(screen.getByRole("option", { name: "One batch" })).toBeTruthy();
});

it("separates unread and read family notices and gives the mark-read action context", async () => {
  render(await SelfInboxPage({ audience: "guardian" }));
  expect(within(screen.getByRole("region", { name: "Unread announcements" })).getByRole("button", { name: "Mark Weekend training as read" })).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Previously read" })).getByText("Earlier timetable")).toBeTruthy();
});

it("identifies the supported signed receipt without offering a broken link for an unlinked payment", async () => {
  const response = await signedParent(new Request("https://localhost/p/demo"), { params: Promise.resolve({ token: "demo" }) });
  const html = await response.text();
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector("h1")?.textContent).toBe("Anika Joshi");
  expect(document.querySelector('a[href="/p/demo/receipt/p1"]')?.getAttribute("aria-label")).toMatch(/Download receipt.*NOV-01/);
  expect(document.querySelector('a[href="/p/demo/receipt/p2"]')).toBeNull();
  expect(document.querySelectorAll("script")).toHaveLength(0);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
