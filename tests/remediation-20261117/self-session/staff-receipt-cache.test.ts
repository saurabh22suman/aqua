import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), permission: vi.fn(), receipt: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: mocks.context }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: mocks.permission }));
vi.mock("@/lib/services/receipts", () => ({ getOrCreateReceipt: mocks.receipt }));
import { GET } from "@/app/api/receipts/[paymentId]/route";
import type { NextRequest } from "next/server";

beforeEach(() => { vi.resetAllMocks(); mocks.context.mockResolvedValue({}); mocks.permission.mockReturnValue(true); mocks.receipt.mockResolvedValue({ ok: true, pdf: new Uint8Array([1, 2]), fileName: "receipt.pdf" }); });
const call = () => GET({} as NextRequest, { params: Promise.resolve({ paymentId: "payment" }) });
it.each(["success", "unauthenticated", "forbidden", "missing"] as const)("uses no-store for %s", async state => {
  if (state === "unauthenticated") mocks.context.mockRejectedValue(new Error("unauthenticated"));
  if (state === "forbidden") mocks.permission.mockReturnValue(false);
  if (state === "missing") mocks.receipt.mockResolvedValue({ ok: false });
  const response = await call();
  expect(response.status).toBe(state === "success" ? 200 : 404);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("vary")).toContain("Cookie");
  if (state === "unauthenticated" || state === "forbidden") expect(mocks.receipt).not.toHaveBeenCalled();
});
it("uses no-store for an unexpected receipt service error", async () => {
  mocks.receipt.mockRejectedValue(new Error("database unavailable"));
  const response = await call();
  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("vary")).toContain("Cookie");
});
