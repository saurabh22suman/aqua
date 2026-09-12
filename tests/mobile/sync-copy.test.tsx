// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";import { afterEach, describe, expect, it, vi } from "vitest";

// Phase 3 (mobile UX plan v2) — F31. The register's sync line said
// "synced never" (and "synced HH:MM" anywhere), which reads as a
// failure state on a fresh register and never says where the data
// actually is. The hook now exposes the persisted-time label (or
// null); the component says "Saved at HH:MM" / "Saved on this phone".

type HookState = {
  savedAtLabel: string | null;
  pending: number;
  online: boolean;
  hasActiveFailure: boolean;
};

const state: HookState = {
  savedAtLabel: "05:00 pm",
  pending: 0,
  online: true,
  hasActiveFailure: false,
};

vi.mock("@/lib/hooks/use-offline-register", () => ({
  useOfflineRegister: () => ({
    marks: {},
    mark: vi.fn(),
    markedCount: 0,
    pending: state.pending,
    online: state.online,
    savedAtLabel: state.savedAtLabel,
    hasActiveFailure: state.hasActiveFailure,
    saving: 0,
    waitForPendingWrites: vi.fn(),
    retrySync: vi.fn(),
  }),
}));

import { RegisterBoard } from "@/components/register-board";

const ROWS = [
  { memberId: "m1", name: "Anu", code: "M1", status: null, pct: 0, isTrial: false },
];

afterEach(() => {
  cleanup();
  state.savedAtLabel = "05:00 pm";
  state.pending = 0;
  state.online = true;
  state.hasActiveFailure = false;
});

describe("register sync label (F31)", () => {
  it("says 'Saved at 05:00 pm' once a sync has landed", () => {
    render(
      <RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={true} />,
    );
    expect(screen.getByText(/Saved at 05:00 pm/)).toBeTruthy();
    expect(screen.queryByText(/synced/i)).toBeNull();
  });

  it("says 'Saved on this phone' before the first sync, never 'synced never'", () => {
    state.savedAtLabel = null;
    render(
      <RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={true} />,
    );
    expect(screen.getByText(/Saved on this phone/)).toBeTruthy();
    expect(screen.queryByText(/never/i)).toBeNull();
  });

  it("exposes a copy-independent sync state for the e2e harness", () => {
    // The offline e2e's drain detector used to grep for /^synced / —
    // renaming the copy broke the probe while the sync still worked.
    // data-sync-state is the stable contract.
    render(
      <RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={true} />,
    );
    expect(
      screen.getByTestId("sync-state").getAttribute("data-sync-state"),
    ).toBe("synced");
    cleanup();

    state.savedAtLabel = null;
    render(
      <RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={true} />,
    );
    expect(
      screen.getByTestId("sync-state").getAttribute("data-sync-state"),
    ).toBe("idle");
    cleanup();

    state.savedAtLabel = "05:00 pm";
    state.online = false;
    state.pending = 2;
    render(
      <RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={true} />,
    );
    expect(
      screen.getByTestId("sync-state").getAttribute("data-sync-state"),
    ).toBe("offline");
  });
});
