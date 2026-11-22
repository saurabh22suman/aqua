// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform-auth", () => ({ platformAuthStatusAction: async () => ({ kind: "authenticated", role: "operator" }) }));
vi.mock("@/lib/auth/ops-operation", () => ({ runOpsGlobalRead: async (_operation: string, read: () => Promise<unknown>) => read() }));
vi.mock("@/db/platform-tenants", () => ({ listTenants: async () => ({ total: 45, rows: [] }), listAllPlansForFilter: async () => [] }));
vi.mock("@/db/platform-presets", () => ({ listPresets: async () => [] }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

import PlatformTenantsPage from "@/app/(platform)/ops/tenants/page";

describe("stale tenant-list pagination", () => {
  it("redirects to the last page without dropping filters", async () => {
    await expect(PlatformTenantsPage({ searchParams: Promise.resolve({ page: "999", search: "pool", status: "active", health: "attention" }) }))
      .rejects.toThrow("redirect:/ops/tenants?search=pool&status=active&health=attention&page=3");
  });
});
