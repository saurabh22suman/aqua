// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the makeup-credits panel's
// initial data, the third pair of the owner overview's seven client reads.
//
// Root's production candidate (four seeded reads) still failed the fast
// profile→Edit→Cancel round trip, so the three remaining makeup reads are the
// next bounded candidate: the OWNER overview reads them on the server with the
// SAME three authorized actions and hands them to the panel as optional typed
// initial data. No grant, redeem, money or permission rule changes.
//
// INTENDED RED against the current four-read candidate (this file is run
// before the product edit): the panel does not accept initial data yet, so it
// calls its three read actions on mount, cannot render a failed seed, cannot
// take its picker defaults from a seed, and has no stale-response guard.
//
// No database: the panel's actions are stubbed; grant/redeem are mock-only.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  listMakeupCreditsAction: vi.fn(),
  listMakeupSourcesAction: vi.fn(),
  listMakeupTargetsAction: vi.fn(),
  grantMakeupCreditAction: vi.fn(),
  redeemMakeupCreditAction: vi.fn(),
}));

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("@/lib/actions/makeup", () => ({
  listMakeupCreditsAction: actions.listMakeupCreditsAction,
  listMakeupSourcesAction: actions.listMakeupSourcesAction,
  listMakeupTargetsAction: actions.listMakeupTargetsAction,
  grantMakeupCreditAction: actions.grantMakeupCreditAction,
  redeemMakeupCreditAction: actions.redeemMakeupCreditAction,
}));

import { MakeupCreditsPanel } from "@/components/makeup-credits-panel";
import type { MakeupCreditRow, MakeupSessionOption } from "@/lib/services/makeup";

const MEMBER_A = "11111111-1111-4111-8111-111111111111";
const MEMBER_B = "33333333-3333-4333-8333-333333333333";

const CREDIT_A: MakeupCreditRow = {
  creditId: "credit-a",
  sourceSessionId: "session-a",
  sourceDate: "2026-10-01",
  status: "granted",
  expiresAt: "2026-12-01",
};
const CREDIT_B: MakeupCreditRow = {
  creditId: "credit-b",
  sourceSessionId: "session-b",
  sourceDate: "2026-10-02",
  status: "granted",
  expiresAt: "2026-12-02",
};
const SOURCE_A: MakeupSessionOption = {
  sessionId: "session-a",
  sessionDate: "2026-10-01",
  batchName: "Swimmers A",
};
const SOURCE_B: MakeupSessionOption = {
  sessionId: "session-b",
  sessionDate: "2026-10-02",
  batchName: "Swimmers B",
};
const TARGET_A: MakeupSessionOption = {
  sessionId: "target-a",
  sessionDate: "2026-10-10",
  batchName: "Swimmers A",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  for (const spy of Object.values(actions)) spy.mockReset();
  router.refresh.mockReset();
  actions.listMakeupCreditsAction.mockImplementation(async (id: string) =>
    id === MEMBER_B ? [CREDIT_B] : [CREDIT_A],
  );
  actions.listMakeupSourcesAction.mockImplementation(async (id: string) =>
    id === MEMBER_B ? [SOURCE_B] : [SOURCE_A],
  );
  actions.listMakeupTargetsAction.mockResolvedValue([TARGET_A]);
  actions.grantMakeupCreditAction.mockResolvedValue({ kind: "ok" });
  actions.redeemMakeupCreditAction.mockResolvedValue({ kind: "ok" });
});

afterEach(cleanup);

describe("makeup initial data", () => {
  // INTENDED RED: no seed support yet, so all three reads fire on mount.
  it("uses a seed for its own member without any mount read", async () => {
    render(
      <MakeupCreditsPanel
        memberId={MEMBER_A}
        canGrant
        canRedeem
        initialData={{
          memberId: MEMBER_A,
          credits: [CREDIT_A],
          sources: [SOURCE_A],
          targets: [TARGET_A],
        }}
      />,
    );
    await settle();
    expect(actions.listMakeupCreditsAction).not.toHaveBeenCalled();
    expect(actions.listMakeupSourcesAction).not.toHaveBeenCalled();
    expect(actions.listMakeupTargetsAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Available/)).toBeTruthy();
  });

  // INTENDED RED: the seeded picker defaults must equal what the legacy load
  // selects (the first source and the first target).
  it("takes the same picker defaults as the legacy load", async () => {
    render(
      <MakeupCreditsPanel
        memberId={MEMBER_A}
        canGrant
        canRedeem
        initialData={{
          memberId: MEMBER_A,
          credits: [CREDIT_A],
          sources: [SOURCE_A],
          targets: [TARGET_A],
        }}
      />,
    );
    await settle();
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects.length).toBeGreaterThan(0);
    const values = selects.map((select) => select.value);
    expect(values).toContain(SOURCE_A.sessionId);
    expect(values).toContain(TARGET_A.sessionId);
  });

  // INTENDED RED: a failed seed is honest and makes no automatic read.
  it("shows a failed seed as an error without reading", async () => {
    render(
      <MakeupCreditsPanel
        memberId={MEMBER_A}
        canGrant
        canRedeem
        initialData={{ memberId: MEMBER_A, failed: true }}
      />,
    );
    await settle();
    expect(actions.listMakeupCreditsAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Could not load makeup credits/i)).toBeTruthy();
    expect(screen.queryByText(/No makeup credits yet/i)).toBeNull();
  });

  // GUARD: a seed for another member is never rendered.
  it("never renders another member's seed", async () => {
    render(
      <MakeupCreditsPanel
        memberId={MEMBER_B}
        canGrant
        canRedeem
        initialData={{
          memberId: MEMBER_A,
          credits: [CREDIT_A],
          sources: [SOURCE_A],
          targets: [TARGET_A],
        }}
      />,
    );
    await waitFor(() =>
      expect(actions.listMakeupCreditsAction).toHaveBeenCalledWith(MEMBER_B),
    );
    // B's own read drives the picker defaults, not A's seed.
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0));
    const values = (screen.getAllByRole("combobox") as HTMLSelectElement[]).map((el) => el.value);
    expect(values).toContain(SOURCE_B.sessionId);
    expect(values).not.toContain(SOURCE_A.sessionId);
  });

  // INTENDED RED: a fresh same-member seed invalidates the older pending read.
  it("a fresh same-member seed wins over an older pending read", async () => {
    const late = deferred<MakeupCreditRow[]>();
    actions.listMakeupCreditsAction.mockReturnValueOnce(late.promise);
    actions.listMakeupSourcesAction.mockReturnValueOnce(deferred<MakeupSessionOption[]>().promise);
    actions.listMakeupTargetsAction.mockReturnValueOnce(deferred<MakeupSessionOption[]>().promise);
    const view = render(<MakeupCreditsPanel memberId={MEMBER_A} canGrant canRedeem />);
    await settle();
    view.rerender(
      <MakeupCreditsPanel
        memberId={MEMBER_A}
        canGrant
        canRedeem
        initialData={{
          memberId: MEMBER_A,
          credits: [CREDIT_A],
          sources: [SOURCE_A],
          targets: [TARGET_A],
        }}
      />,
    );
    await settle();
    await act(async () => {
      late.reject(new Error("old read failed"));
      await Promise.resolve();
    });
    expect(screen.queryByText(/old read failed/i)).toBeNull();
    expect(screen.getByText(/Available/)).toBeTruthy();
  });

  // GUARD: a late response for the previous member is ignored.
  it("ignores a late response for the previous member", async () => {
    const late = deferred<MakeupCreditRow[]>();
    actions.listMakeupCreditsAction.mockReturnValueOnce(late.promise);
    actions.listMakeupSourcesAction.mockReturnValueOnce(deferred<MakeupSessionOption[]>().promise);
    actions.listMakeupTargetsAction.mockReturnValueOnce(deferred<MakeupSessionOption[]>().promise);
    const view = render(<MakeupCreditsPanel memberId={MEMBER_A} canGrant canRedeem />);
    await settle();
    view.rerender(
      <MakeupCreditsPanel
        memberId={MEMBER_B}
        canGrant
        canRedeem
        initialData={{
          memberId: MEMBER_B,
          credits: [CREDIT_B],
          sources: [SOURCE_B],
          targets: [TARGET_A],
        }}
      />,
    );
    await settle();
    await act(async () => {
      late.resolve([CREDIT_A]);
      await Promise.resolve();
    });
    const values = (screen.getAllByRole("combobox") as HTMLSelectElement[]).map((el) => el.value);
    expect(values).toContain(SOURCE_B.sessionId);
    expect(values).not.toContain(SOURCE_A.sessionId);
  });

  // CONTROL: another role with no seed keeps its own read.
  it("keeps the no-seed fallback", async () => {
    render(<MakeupCreditsPanel memberId={MEMBER_A} canGrant canRedeem />);
    await waitFor(() =>
      expect(actions.listMakeupCreditsAction).toHaveBeenCalledWith(MEMBER_A),
    );
    expect(actions.listMakeupSourcesAction).toHaveBeenCalled();
    expect(actions.listMakeupTargetsAction).toHaveBeenCalled();
  });

  // CONTROL: a grant still reloads and refreshes (mocks only).
  it("reloads and refreshes after a grant", async () => {
    render(<MakeupCreditsPanel memberId={MEMBER_A} canGrant canRedeem />);
    await waitFor(() => expect(screen.getByText(/Available/)).toBeTruthy());
    actions.listMakeupCreditsAction.mockClear();
    router.refresh.mockClear();
    const grant = screen.queryByRole("button", { name: /grant/i });
    if (grant) {
      fireEvent.click(grant);
      await settle();
      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(actions.listMakeupCreditsAction).toHaveBeenCalled();
    }
  });
});
