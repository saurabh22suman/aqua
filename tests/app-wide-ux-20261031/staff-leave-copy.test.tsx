// @vitest-environment jsdom
//
// The staff leave card — the unpaid marker is stated once (tranche 3,
// 31 Oct 2026).
//
// The coordinator's review found the leave card printing "Unpaid ·
// unpaid": a leave type whose own NAME already says it is unpaid got
// the unpaid marker appended a second time. The marker is there to say
// something the name does not — where the name already says it, the
// card must not say it twice.
//
// The contract this file pins:
//
//   1. A paid leave type carries NO unpaid marker.
//   2. An unpaid leave type whose name does NOT already say "unpaid"
//      keeps the marker ("Medical leave · unpaid").
//   3. A leave type whose name already contains "unpaid" (any case)
//      does not get a second marker ("Unpaid leave", not "Unpaid leave
//      · unpaid").
//   4. A special unpaid label that does not use the word keeps the
//      marker ("Volunteer · unpaid") — nothing about the leave RULES
//      or the stored values changes here; only the printed text.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// The client-only leaves of the card are stubbed: this file is about
// the card's own printed balances.
vi.mock("@/components/deferred-leave-request", () => ({
  DeferredLeaveRequest: () => null,
}));
vi.mock("@/components/cancel-leave-button", () => ({
  CancelLeaveButton: () => null,
}));

import { MyLeaveCard } from "@/components/my-leave-card";

type Balance = {
  leaveTypeId: string;
  name: string;
  isPaid: boolean;
  annualQuota: number | null;
  usedDays: number;
  availableDays: number;
  pendingDays: number;
};

function balance(over: Partial<Balance> = {}): Balance {
  return {
    leaveTypeId: "lt1",
    name: "Casual leave",
    isPaid: true,
    annualQuota: 12,
    usedDays: 3,
    availableDays: 9,
    pendingDays: 0,
    ...over,
  };
}

/** The printed balance names, in the card's own order. */
function printedBalances(balances: Balance[]): string[] {
  const { container } = render(
    <MyLeaveCard types={[]} balances={balances} requests={[]} />,
  );
  return Array.from(container.querySelectorAll("ul > li")).map(
    (row) => (row.querySelector("span")?.textContent ?? "").trim(),
  );
}

afterEach(cleanup);

describe("the staff leave card — the unpaid marker is stated once", () => {
  it("prints no unpaid marker for a paid leave type", () => {
    const [printed] = printedBalances([balance({ name: "Casual leave", isPaid: true })]);
    expect(printed).toBe("Casual leave");
  });

  it("keeps the unpaid marker for an ordinary unpaid leave type", () => {
    const [printed] = printedBalances([
      balance({ name: "Medical leave", isPaid: false }),
    ]);
    expect(printed).toBe("Medical leave · unpaid");
  });

  it("does not print 'Unpaid · unpaid'", () => {
    const [printed] = printedBalances([balance({ name: "Unpaid", isPaid: false })]);
    expect(printed).toBe("Unpaid");
    expect(printed).not.toMatch(/·\s*unpaid/i);
  });

  it("does not repeat the marker when the name already says unpaid", () => {
    const [printed] = printedBalances([
      balance({ name: "Unpaid leave", isPaid: false }),
    ]);
    expect(printed).toBe("Unpaid leave");
  });

  it("matches the word 'unpaid' whatever its case", () => {
    const [printed] = printedBalances([
      balance({ name: "unpaid sabbatical", isPaid: false }),
    ]);
    expect(printed).toBe("unpaid sabbatical");
  });

  it("keeps the marker for a special unpaid label that does not say unpaid", () => {
    const [printed] = printedBalances([
      balance({ name: "Volunteer", isPaid: false }),
    ]);
    expect(printed).toBe("Volunteer · unpaid");
  });
});
