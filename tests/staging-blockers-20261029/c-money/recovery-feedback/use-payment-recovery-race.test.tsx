// @vitest-environment jsdom
//
// L-01 — a superseded recovery read must not return its stale snapshot to
// the caller that decides the ambiguity copy. The newest read wins.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentIntentRecovery } from "@/lib/services/payment-intent-recovery";
import { usePaymentRecovery } from "@/components/use-payment-recovery";

const EMPTY: PaymentIntentRecovery = { open: null, lastCommitted: null };

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePaymentRecovery refresh generation", () => {
  it("returns null for a superseded read instead of the stale snapshot", async () => {
    let resolveFirst: ((value: PaymentIntentRecovery) => void) | undefined;
    let resolveSecond: ((value: PaymentIntentRecovery) => void) | undefined;
    const list = vi
      .fn<(...args: unknown[]) => Promise<PaymentIntentRecovery>>()
      .mockResolvedValueOnce(EMPTY)
      .mockImplementationOnce(
        () =>
          new Promise<PaymentIntentRecovery>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<PaymentIntentRecovery>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const { result } = renderHook(() =>
      usePaymentRecovery("target-1", list, vi.fn()),
    );
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    let first: Promise<PaymentIntentRecovery | null> | undefined;
    let second: Promise<PaymentIntentRecovery | null> | undefined;
    act(() => {
      first = result.current.refresh();
    });
    act(() => {
      second = result.current.refresh();
    });

    resolveSecond!(EMPTY);
    await act(async () => {
      await second;
    });

    resolveFirst!({
      open: {
        intentId: "old-intent",
        idempotencyKey: "old-key",
        createdAt: "2026-10-29T10:00:00.000Z",
      },
      lastCommitted: null,
    });
    const stale = await first!;

    expect(stale).toBeNull();
    expect(result.current.recovery).toEqual(EMPTY);
  });
});
