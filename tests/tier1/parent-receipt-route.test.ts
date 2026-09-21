// @vitest-environment node
//
// PR2-C11 — the token-scoped receipt route. The token is the
// credential; anything invalid, foreign or missing is the same 404.

import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyParentLinkToken = vi.fn();
vi.mock("@/lib/services/parent-link", () => ({
  verifyParentLinkToken: (...args: unknown[]) => verifyParentLinkToken(...args),
}));

const getReceiptForMember = vi.fn();
vi.mock("@/lib/services/receipts", () => ({
  getReceiptForMember: (...args: unknown[]) => getReceiptForMember(...args),
}));

import { GET } from "@/app/p/[token]/receipt/[paymentId]/route";

const PARAMS = Promise.resolve({
  token: "tok",
  paymentId: "11111111-1111-7111-8111-111111111111",
});

function request(): Request {
  return new Request("http://localhost/p/tok/receipt/x");
}

describe("parent receipt route (PR2-C11)", () => {
  beforeEach(() => {
    verifyParentLinkToken.mockReset();
    getReceiptForMember.mockReset();
  });

  it("404s a forged or expired token without calling the service", async () => {
    verifyParentLinkToken.mockReturnValue(null);
    const response = await GET(request() as never, { params: PARAMS });
    expect(response.status).toBe(404);
    expect(getReceiptForMember).not.toHaveBeenCalled();
  });

  it("serves the PDF for the token's own payment", async () => {
    verifyParentLinkToken.mockReturnValue({
      tenantId: "22222222-2222-7222-8222-222222222222",
      personId: "33333333-3333-7333-8333-333333333333",
      scope: "parent_view",
    });
    getReceiptForMember.mockResolvedValue({
      ok: true,
      pdf: Buffer.from("%PDF-1.4 test"),
      fileName: "receipt-INV-1.pdf",
    });

    const response = await GET(request() as never, { params: PARAMS });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(
      "receipt-INV-1.pdf",
    );
    expect(getReceiptForMember).toHaveBeenCalledWith(
      "22222222-2222-7222-8222-222222222222",
      "33333333-3333-7333-8333-333333333333",
      "11111111-1111-7111-8111-111111111111",
    );
  });

  it("404s when the payment belongs to another child or tenant", async () => {
    verifyParentLinkToken.mockReturnValue({
      tenantId: "22222222-2222-7222-8222-222222222222",
      personId: "33333333-3333-7333-8333-333333333333",
      scope: "parent_view",
    });
    getReceiptForMember.mockResolvedValue({
      ok: false,
      error: "Receipt not found.",
    });

    const response = await GET(request() as never, { params: PARAMS });
    expect(response.status).toBe(404);
  });
});
