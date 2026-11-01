import { expect, it, vi } from "vitest";
// Adapter unit test only: authorization and the service are intentionally mocked.
const { unexpected } = vi.hoisted(() => ({ unexpected: new Error("database unavailable") }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ({}) }));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: () => undefined }));
vi.mock("@/lib/services/programs", async (importOriginal) => {
    const original = await importOriginal<typeof import("@/lib/services/programs")>();
    return { ...original, createBatch: async () => { throw unexpected; } };
});
import { createBatchAction } from "@/lib/actions/programs";
it("propagates unexpected failures rather than mapping them to a location refusal", async () => {
    await expect(createBatchAction({
        programId: "00000000-0000-4000-8000-000000000001",
        name: "Example",
        capacity: 4,
        daysOfWeek: [1],
        startTime: "10:00",
        endTime: "11:00",
    })).rejects.toBe(unexpected);
});
