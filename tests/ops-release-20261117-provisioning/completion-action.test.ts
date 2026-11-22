import { describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ require: vi.fn(), trace: vi.fn() }));
vi.mock("@/lib/actions/platform-auth", () => ({ requireOpsAdminAction: gate.require }));
vi.mock("@/lib/auth/ops-operation", () => ({ recordOpsMutationTrace: gate.trace, recordOpsThrownFailure: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { completeLeadAction } from "@/lib/actions/platform-leads";

describe("completion action boundary", () => {
  it("rejects missing reason and a read-only operator", async () => {
    const lead = "01900000-0000-7000-8000-000000000001";
    const tenant = "01900000-0000-7000-8000-000000000002";
    expect((await completeLeadAction(lead, tenant, " ")).kind).toBe("error");
    expect(gate.require).not.toHaveBeenCalled();
    gate.require.mockResolvedValue({ kind: "error", reason: "forbidden" });
    expect((await completeLeadAction(lead, tenant, "Signed agreement")).kind).toBe("error");
    expect(gate.trace).toHaveBeenCalledWith("platform_lead.update", "denied");
  });
});
