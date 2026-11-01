// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
vi.mock("next/link", async () => { const React = await import("react"); return { default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => React.createElement("a", { href, ...rest }, children) }; });
import { OwnerHomeMoney } from "@/components/owner-home/owner-home-money";
afterEach(cleanup);
it("names the Today transaction link with its displayed amount and provides a minimum hit-area contract", () => {
  render(<OwnerHomeMoney money={{ collectedTodayPaise: 2100000, collectedTodayCount: 2, outstandingPaise: 0, dueInvoiceCount: 0, overduePaise: 0, overdueInvoiceCount: 0, oldestOverdueDays: null }} context={{ activeMemberCount: 0, activeBatchCount: 0, sessionCount: 0, membersLabel: "members", batchesLabel: "batches", sessionsLabel: "sessions" }} collectedHref="/owner/fees?tab=transactions" collectHref={null} addMemberHref={null} captureEnquiryHref={null} memberLabel="member" enquiryLabel="enquiry" last7Paise={2375000} />);
  const link = screen.getByRole("link", { name: /₹21,000.*view today's transactions/i });
  expect(link.getAttribute("href")).toBe("/owner/fees?tab=transactions");
  expect(link.textContent).toBe("₹21,000");
  expect(link.className).toContain("min-h-11");
  expect(screen.getByText("₹23,750")).toBeTruthy();
});
it("provides a minimum-height contract on the Today link", () => {
  render(<OwnerHomeMoney money={{ collectedTodayPaise: 100, collectedTodayCount: 1, outstandingPaise: 0, dueInvoiceCount: 0, overduePaise: 0, overdueInvoiceCount: 0, oldestOverdueDays: null }} context={{ activeMemberCount: 0, activeBatchCount: 0, sessionCount: 0, membersLabel: "members", batchesLabel: "batches", sessionsLabel: "sessions" }} collectedHref="/owner/fees" collectHref={null} addMemberHref={null} captureEnquiryHref={null} memberLabel="member" enquiryLabel="enquiry" />);
  expect(screen.getByRole("link").className).toContain("min-h-11");
});
it("renders a decorative sport motif without obscuring the two real collection values", () => {
  render(<OwnerHomeMoney money={{ collectedTodayPaise: 2100000, collectedTodayCount: 2, outstandingPaise: 0, dueInvoiceCount: 0, overduePaise: 0, overdueInvoiceCount: 0, oldestOverdueDays: null }} context={{ activeMemberCount: 0, activeBatchCount: 0, sessionCount: 0, membersLabel: "members", batchesLabel: "batches", sessionsLabel: "sessions" }} collectHref={null} addMemberHref={null} captureEnquiryHref={null} memberLabel="member" enquiryLabel="enquiry" last7Paise={2375000} />);
  const region = screen.getByRole("region", { name: "Collections" });
  expect(region.textContent).toContain("₹21,000");
  expect(region.textContent).toContain("₹23,750");
  expect(region.querySelector('[data-owner-artwork][aria-hidden="true"]')).toBeTruthy();
});
it("uses this user and tenant's saved motif, while None suppresses decoration", async () => {
  window.localStorage.setItem("aqua:owner-art:tenant-a:user-a", "tennis");
  const props = { money: { collectedTodayPaise: 2100000, collectedTodayCount: 2, outstandingPaise: 0, dueInvoiceCount: 0, overduePaise: 0, overdueInvoiceCount: 0, oldestOverdueDays: null }, context: { activeMemberCount: 0, activeBatchCount: 0, sessionCount: 0, membersLabel: "members", batchesLabel: "batches", sessionsLabel: "sessions" }, collectHref: null, addMemberHref: null, captureEnquiryHref: null, memberLabel: "member", enquiryLabel: "enquiry" };
  const { rerender } = render(<OwnerHomeMoney {...props} {...{ artworkIdentity: { tenantId: "tenant-a", userId: "user-a" } }} />);
  const image = screen.getByRole("region", { name: "Collections" }).querySelector<HTMLElement>("[data-owner-artwork]");
  expect(image?.style.maskImage).toContain("tennis");
  window.localStorage.setItem("aqua:owner-art:tenant-b:user-a", "none");
  rerender(<OwnerHomeMoney {...props} {...{ artworkIdentity: { tenantId: "tenant-b", userId: "user-a" } }} />);
  expect(screen.getByRole("region", { name: "Collections" }).querySelector("[data-owner-artwork]")).toBeNull();
  window.localStorage.removeItem("aqua:owner-art:tenant-a:user-a");
  window.localStorage.removeItem("aqua:owner-art:tenant-b:user-a");
});
it("uses the safe default for malformed or inaccessible storage and isolates users", () => {
  const props = { money: { collectedTodayPaise: 0, collectedTodayCount: 0, outstandingPaise: 0, dueInvoiceCount: 0, overduePaise: 0, overdueInvoiceCount: 0, oldestOverdueDays: null }, context: { activeMemberCount: 0, activeBatchCount: 0, sessionCount: 0, membersLabel: "members", batchesLabel: "batches", sessionsLabel: "sessions" }, collectHref: null, addMemberHref: null, captureEnquiryHref: null, memberLabel: "member", enquiryLabel: "enquiry" };
  window.localStorage.setItem("aqua:owner-art:tenant-a:user-a", "none");
  window.localStorage.setItem("aqua:owner-art:tenant-a:user-b", "invalid");
  const { rerender } = render(<OwnerHomeMoney {...props} {...{ artworkIdentity: { tenantId: "tenant-a", userId: "user-b" } }} />);
  expect(screen.getByRole("region", { name: "Collections" }).querySelector<HTMLElement>("[data-owner-artwork]")?.style.maskImage).toContain("multi-sport");
  const denied = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  rerender(<OwnerHomeMoney {...props} {...{ artworkIdentity: { tenantId: "tenant-c", userId: "user-b" } }} />);
  expect(screen.getByRole("region", { name: "Collections" }).querySelector<HTMLElement>("[data-owner-artwork]")?.style.maskImage).toContain("multi-sport");
  denied.mockRestore();
  window.localStorage.removeItem("aqua:owner-art:tenant-a:user-a");
  window.localStorage.removeItem("aqua:owner-art:tenant-a:user-b");
});
it("selects one intrinsic geometry from card width rather than viewport width", () => {
  let update: ((width: number) => void) | undefined;
  class Observer {
    constructor(callback: ResizeObserverCallback) { update = width => callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    observe() {} disconnect() {} unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", Observer);
  const view = render(<OwnerHomeMoney money={{ collectedTodayPaise: 100, collectedTodayCount: 1, outstandingPaise: 0, dueInvoiceCount: 0, overduePaise: 0, overdueInvoiceCount: 0, oldestOverdueDays: null }} context={{ activeMemberCount: 0, activeBatchCount: 0, sessionCount: 0, membersLabel: "members", batchesLabel: "batches", sessionsLabel: "sessions" }} collectHref={null} addMemberHref={null} captureEnquiryHref={null} memberLabel="member" enquiryLabel="enquiry" />);
  const image = () => view.container.querySelector<HTMLElement>("[data-owner-artwork]")?.style.maskImage;
  act(() => update?.(319)); expect(image()).toContain("-tall-");
  act(() => update?.(320)); expect(image()).toContain("-phone-");
  act(() => update?.(459)); expect(image()).toContain("-phone-");
  act(() => update?.(460)); expect(image()).toContain("-wide-");
  expect(view.container.querySelectorAll("[data-owner-artwork]")).toHaveLength(1);
  vi.unstubAllGlobals();
});
it("keeps large paise amounts exact and distinct", () => {
  render(<OwnerHomeMoney money={{ collectedTodayPaise: 123456789000, collectedTodayCount: 1, outstandingPaise: 0, dueInvoiceCount: 0, overduePaise: 0, overdueInvoiceCount: 0, oldestOverdueDays: null }} context={{ activeMemberCount: 0, activeBatchCount: 0, sessionCount: 0, membersLabel: "members", batchesLabel: "batches", sessionsLabel: "sessions" }} collectHref={null} addMemberHref={null} captureEnquiryHref={null} memberLabel="member" enquiryLabel="enquiry" last7Paise={987654321000} />);
  const text = screen.getByRole("region", { name: "Collections" }).textContent ?? "";
  expect(text).toContain("₹1,23,45,67,890");
  expect(text).toContain("₹9,87,65,43,210");
});
it("refreshes the decoration when returning to a cached page", () => {
  const identity = { tenantId: "back-tenant", userId: "back-user" };
  const props = { money: { collectedTodayPaise: 0, collectedTodayCount: 0, outstandingPaise: 0, dueInvoiceCount: 0, overduePaise: 0, overdueInvoiceCount: 0, oldestOverdueDays: null }, context: { activeMemberCount: 0, activeBatchCount: 0, sessionCount: 0, membersLabel: "members", batchesLabel: "batches", sessionsLabel: "sessions" }, collectHref: null, addMemberHref: null, captureEnquiryHref: null, memberLabel: "member", enquiryLabel: "enquiry" };
  window.localStorage.setItem("aqua:owner-art:back-tenant:back-user", "tennis");
  const view = render(<OwnerHomeMoney {...props} artworkIdentity={identity} />);
  window.localStorage.setItem("aqua:owner-art:back-tenant:back-user", "none");
  act(() => window.dispatchEvent(new Event("pageshow")));
  expect(view.container.querySelector("[data-owner-artwork]")).toBeNull();
  window.localStorage.removeItem("aqua:owner-art:back-tenant:back-user");
});
