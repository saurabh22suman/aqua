import { expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/platform-auth", () => ({ platformAuthStatusAction: auth }));
vi.mock("@/lib/auth/ops-operation", () => ({ runOpsRead: async (_op: string, _id: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/db/ops-diagnostics-view", () => ({ getTenantDiagnostics: read, MEMBERSHIP_DIAGNOSTIC_LIMIT: 50 }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not found"); } }));
import Diagnostics from "@/app/(platform)/ops/tenants/[tenantId]/diagnostics/page";
it("passes a requested older page into the audited read", async () => {
  auth.mockResolvedValue({ kind: "authenticated", role: "admin" });
  read.mockResolvedValue({ total: 120, memberships: [], selected: null, entitlements: [] });
  const props = { params: Promise.resolve({ tenantId: "a" }), searchParams: Promise.resolve({ page: "2" }) };
  await Diagnostics(props);
  expect(read).toHaveBeenCalledWith("a", expect.objectContaining({ page: 2 }));
});
it("refuses a viewer before the data read", async () => {
  read.mockClear();
  auth.mockResolvedValue({ kind: "authenticated", role: "viewer" });
  await Diagnostics({ params: Promise.resolve({ tenantId: "a" }), searchParams: Promise.resolve({}) });
  expect(read).not.toHaveBeenCalled();
});
it("redirects a stale page to the last page while preserving membership", async () => {
  auth.mockResolvedValue({ kind: "authenticated", role: "admin" });
  read.mockResolvedValue({ total: 120, memberships: [], selected: null, entitlements: [] });
  const membership = "550e8400-e29b-41d4-a716-446655440000";
  const props = { params: Promise.resolve({ tenantId: "a" }), searchParams: Promise.resolve({ page: "999", membership }) };
  await expect(Diagnostics(props)).rejects.toThrow(`redirect:?page=3&membership=${membership}`);
});
