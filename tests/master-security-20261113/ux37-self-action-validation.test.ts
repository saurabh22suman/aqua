import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ resolve: vi.fn(), mark: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/self-scope", () => ({ resolveSelfScope: mock.resolve }));
vi.mock("@/lib/services/announcements", () => ({ markSelfNotificationReadInTx: mock.mark }));
import { markSelfNotificationAction } from "@/lib/actions/self-notifications";

it("rejects an invalid notification UUID before resolving identity", async () => {
  const form = new FormData(); form.set("notificationId", "not-a-uuid");
  await expect(markSelfNotificationAction("member", form)).rejects.toThrow("not found");
  expect(mock.resolve).not.toHaveBeenCalled();
  expect(mock.mark).not.toHaveBeenCalled();
});

it("rejects an invalid audience before resolving identity", async () => {
  const form = new FormData(); form.set("notificationId", "00000000-0000-4000-8000-000000000001");
  // @ts-expect-error Exercise the runtime action boundary with invalid client input.
  await expect(markSelfNotificationAction("staff", form)).rejects.toThrow("not found");
  expect(mock.resolve).not.toHaveBeenCalled();
});
