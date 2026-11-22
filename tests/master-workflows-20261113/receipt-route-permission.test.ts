import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({permissions:new Set<string>(),signedIn:true}));
const receipt = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/context", () => ({requireDefaultCtx:async () => {if (!state.signedIn) throw new Error("signed out"); return {permissions:state.permissions};}}));
vi.mock("@/lib/services/receipts", () => ({getOrCreateReceipt:receipt}));
import { GET } from "@/app/api/receipts/[paymentId]/route";
beforeEach(() => {state.permissions = new Set();state.signedIn = true;receipt.mockReset();});
const request = () => GET(new NextRequest("http://localhost/api/receipts/p1"),{params:Promise.resolve({paymentId:"p1"})});
it("refuses signed-out or ungranted callers before a receipt lookup", async () => {
  expect((await request()).status).toBe(404);
  state.signedIn = false;
  expect((await request()).status).toBe(404);
  expect(receipt).not.toHaveBeenCalled();
});
it("uses the authorized exact payment lookup and hides a missing scoped result", async () => {
  state.permissions = new Set(["invoices.read"]);
  receipt.mockResolvedValueOnce({ok:false});
  expect((await request()).status).toBe(404);
  expect(receipt).toHaveBeenCalledWith(expect.objectContaining({permissions:state.permissions}),"p1");
  receipt.mockResolvedValueOnce({ok:true,pdf:new Uint8Array([37,80,68,70]),fileName:"receipt.pdf"});
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
});
