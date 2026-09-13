// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// R.7 (docs/five-day-work-guide.md) — makeup credits UI on the member
// detail page. Grant from an excused absence, redeem against another
// session, no fee credit (service comment). TDD: fails before the
// panel exists.

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const listMakeupCreditsAction = vi.hoisted(() =>
  vi.fn(async () => [
    {
      creditId: "c1",
      sourceSessionId: "s1",
      sourceDate: "2026-09-05",
      status: "granted",
      expiresAt: "2026-11-04T00:00:00.000Z",
    },
  ]),
);
const listMakeupSourcesAction = vi.hoisted(() =>
  vi.fn(async () => [
    { sessionId: "s2", sessionDate: "2026-09-07", batchName: "Junior TTS" },
  ]),
);
const listMakeupTargetsAction = vi.hoisted(() =>
  vi.fn(async () => [
    { sessionId: "s3", sessionDate: "2026-09-15", batchName: "Evening Juniors" },
  ]),
);
const grantMakeupCreditAction = vi.hoisted(() =>
  vi.fn(async () => ({
    kind: "ok" as const,
    creditId: "c2",
    memberId: "m1",
    sourceSessionId: "s2",
  })),
);
const redeemMakeupCreditAction = vi.hoisted(() =>
  vi.fn(async () => ({
    kind: "ok" as const,
    creditId: "c1",
    memberId: "m1",
    sourceSessionId: "s1",
  })),
);
vi.mock("@/lib/actions/makeup", () => ({
  listMakeupCreditsAction,
  listMakeupSourcesAction,
  listMakeupTargetsAction,
  grantMakeupCreditAction,
  redeemMakeupCreditAction,
}));

import { MakeupCreditsPanel } from "@/components/makeup-credits-panel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MakeupCreditsPanel (R.7)", () => {
  it("lists credits with their status and source date", async () => {
    render(<MakeupCreditsPanel memberId="m1" />);
    await screen.findByText("5 Sept 2026", { exact: true });
    expect(document.body.textContent).toContain("Available");
  });

  it("grants a credit for the chosen excused absence", async () => {
    render(<MakeupCreditsPanel memberId="m1" />);
    await screen.findByTestId("makeup-source");

    fireEvent.change(screen.getByTestId("makeup-source"), {
      target: { value: "s2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /grant credit/i }));

    await vi.waitFor(() =>
      expect(grantMakeupCreditAction).toHaveBeenCalledWith({
        memberId: "m1",
        sourceSessionId: "s2",
      }),
    );
  });

  it("redeems an available credit against the chosen session", async () => {
    render(<MakeupCreditsPanel memberId="m1" />);
    await screen.findByTestId("makeup-target");

    fireEvent.change(screen.getByTestId("makeup-target"), {
      target: { value: "s3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /redeem/i }));

    await vi.waitFor(() =>
      expect(redeemMakeupCreditAction).toHaveBeenCalledWith({
        memberId: "m1",
        sourceSessionId: "s1",
        targetSessionId: "s3",
      }),
    );
  });
});
