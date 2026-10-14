// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// 2026-10-05 audit FE-05 — the hook persisted the roster from useMemo,
// which runs during render. Client components also render on the
// server, where indexedDB does not exist; that write rejected during
// SSR and surfaced as an unhandled rejection. Rendering the hook must
// not touch browser storage at all; persistence belongs to an effect.

vi.mock("@/lib/actions/coach", () => ({
  markAttendanceSessionAction: vi.fn(async () => ({ ok: true })),
}));

import { useOfflineRegister } from "@/lib/hooks/use-offline-register";

function Probe() {
  useOfflineRegister("session-1", [], {}, true);
  return null;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useOfflineRegister server rendering (FE-05)", () => {
  it("does not read indexedDB while rendering on the server", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    let reads = 0;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        reads += 1;
        throw new Error("indexedDB must not be read during SSR");
      },
    });

    try {
      expect(renderToString(<Probe />)).toBe("");
      await new Promise((r) => setTimeout(r, 0));
      expect(reads).toBe(0);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "indexedDB", original);
      } else {
        delete (globalThis as { indexedDB?: unknown }).indexedDB;
      }
    }
  });
});
