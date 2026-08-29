import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "./fake-indexeddb";

// issue #4, mechanism 2: tx() in lib/offline/idb.ts resolves its
// promise on the underlying request's `onsuccess`, not the enclosing
// transaction's `oncomplete`. A request succeeding means the operation
// was accepted into the transaction — not that the transaction has
// committed. Anything awaiting enqueueMark() (or any other tx()-backed
// call) can believe a mark is durably saved before it actually is.
describe("lib/offline/idb.ts — durability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("enqueueMark's promise does not resolve before the transaction commits (oncomplete), not merely on request success (onsuccess)", async () => {
    let transactionCompleted = false;
    installFakeIndexedDB({
      onTransactionComplete: () => {
        transactionCompleted = true;
      },
    });

    const { enqueueMark } = await import("@/lib/offline/idb");

    await enqueueMark({
      clientId: "c1",
      sessionId: "s1",
      memberId: "m1",
      status: "present",
      savedAt: Date.now(),
      attempts: 0,
    });

    // If this is false here, enqueueMark's caller was told the write
    // succeeded before the underlying transaction actually committed —
    // exactly the gap that let a mark be lost before durable enqueue.
    expect(transactionCompleted).toBe(true);
  });

  it("queueAll only ever sees data after its own transaction has actually committed", async () => {
    let completedCount = 0;
    installFakeIndexedDB({
      onTransactionComplete: () => {
        completedCount++;
      },
    });

    const { enqueueMark, queueAll } = await import("@/lib/offline/idb");
    await enqueueMark({
      clientId: "c2",
      sessionId: "s1",
      memberId: "m2",
      status: "absent",
      savedAt: Date.now(),
      attempts: 0,
    });

    const before = completedCount;
    const all = await queueAll();

    expect(all).toHaveLength(1);
    // queueAll's own read transaction must also have committed by the
    // time it resolves, not just succeeded its getAll() request.
    expect(completedCount).toBeGreaterThan(before);
  });
});
