import { expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "../../offline/fake-indexeddb";
import { activateOfflineIdentity, enqueueMark, queueForIdentity } from "@/lib/offline/idb";
it("orders successive marks by committed queue order even if the clock moves backwards", async () => {
  installFakeIndexedDB();
  const identity = { scope: "a".repeat(64), expiresAt: Date.now() + 60000 };
  await activateOfflineIdentity(identity);
  const mark = { ...identity, sessionId: "s", memberId: "m", status: "present" as const, attempts: 0 };
  await enqueueMark({ ...mark, clientId: "first", savedAt: 100 });
  await enqueueMark({ ...mark, clientId: "second", savedAt: 99 });
  await enqueueMark({ ...mark, clientId: "third", savedAt: 99 });
  const rows = await queueForIdentity(identity);
  expect(rows.map(row => row.clientId)).toEqual(["first", "second", "third"]);
  expect(rows.map(row => row.order)).toEqual([1, 2, 3]);
  vi.unstubAllGlobals();
});
