// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR3-C7 — reception's counter surfaces: Today carries a session-count
// chip and a search entry, the search route lists matches by
// name/phone/code, the payment screen still records (PR2) and the
// bookings tile stays absent (PR1-C5).

vi.mock("@/lib/auth/surface-guard", () => ({
  requireReception: async () => ({ permissions: new Set() }),
}));

const getTodayAction = vi.fn();
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("@/lib/actions/coach", () => ({
  getTodayAction: (...args: unknown[]) => getTodayAction(...args),
  getRosterAction: vi.fn(async () => null),
  markAttendanceSessionAction: vi.fn(async () => ({ ok: true })),
}));

const listMembersAction = vi.fn();
vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...args: unknown[]) => listMembersAction(...args),
}));

vi.mock("@/lib/actions/payment-qrs", () => ({
  listPaymentQrsAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/invoices", () => ({
  listMemberInvoicesAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/payments", () => ({
  recordPaymentAction: vi.fn(async () => ({ ok: true })),
  listInvoicePaymentsAction: vi.fn(async () => []),
}));

import ReceptionTodayPage from "@/app/(reception)/reception/page";
import ReceptionMembersPage from "@/app/(reception)/reception/members/page";
import CollectPaymentPage from "@/app/(reception)/reception/collect-payment/page";

const SESSION = {
  id: "s1",
  startsAt: "2026-09-12T01:30:00.000Z",
  endsAt: "2026-09-12T02:30:00.000Z",
  batchName: "Junior TTS",
  marked: 2,
  total: 16,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("reception Today (PR3-C7)", () => {
  it("shows the session-count chip and a member-search entry", async () => {
    getTodayAction.mockResolvedValue({ sessions: [SESSION, { ...SESSION, id: "s2" }] });
    render(await ReceptionTodayPage());

    expect(screen.getByTestId("count-chip").textContent).toContain("2 sessions");
    expect(screen.getByTestId("member-search-link").getAttribute("href")).toBe(
      "/reception/members",
    );
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.some((href) => href?.startsWith("/reception/bookings"))).toBe(false);
  });
});

describe("reception member search (PR3-C7)", () => {
  it("returns matching records for a query and links to the member", async () => {
    listMembersAction.mockResolvedValue([
      {
        memberId: "m-1",
        fullName: "Audit Child",
        memberCode: "MEM-0001",
        locationName: "Worli Main",
        phone: "+919811100001",
        status: "active",
      },
    ]);
    render(await ReceptionMembersPage({ searchParams: Promise.resolve({ q: "98111" }) }));

    expect(listMembersAction).toHaveBeenCalledWith({ search: "98111" });
    expect(screen.getByTestId("member-result-m-1").getAttribute("href")).toBe(
      "/reception/members/m-1",
    );
    expect(document.body.textContent).toContain("+91 98111 00001");
  });

  it("asks for a query before listing anything", async () => {
    render(await ReceptionMembersPage({}));
    expect(listMembersAction).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Start typing");
  });
});

describe("reception payment screen composition (PR3-C7)", () => {
  it("carries the recording form and never the booking tile", async () => {
    render(await CollectPaymentPage());
    expect(document.body.textContent).toContain("Record a payment");
    expect(document.body.textContent).toContain("Show the payer a QR");
    expect(document.body.textContent).not.toMatch(/Reserve a lane or court/i);
  });
});
