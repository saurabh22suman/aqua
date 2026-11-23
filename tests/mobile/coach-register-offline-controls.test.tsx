// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RegisterBoard } from "@/components/register-board";

const state = vi.hoisted(() => ({ online: false }));

vi.mock("@/lib/hooks/use-offline-register", () => ({
  useOfflineRegister: () => ({
    online: state.online,
    offlineAvailable: false,
    marks: {},
    markedCount: 0,
    pending: 0,
    review: [],
  }),
}));

const ROWS = [{
  memberId: "m1",
  name: "Anu",
  code: "M1",
  status: null,
  pct: 80,
  isTrial: false,
}];

it("keeps register controls visible but disables them until the connection returns", () => {
  state.online = false;
  const view = <RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={false} />;
  const { rerender } = render(view);

  expect(screen.getByTestId("offline-banner").textContent).toMatch(/until you reconnect/i);
  expect((screen.getByTestId("mark-all-present") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByTestId("mark-present-m1") as HTMLButtonElement).disabled).toBe(true);

  state.online = true;
  rerender(<RegisterBoard sessionId="s1" rows={ROWS} offlineSyncEnabled={false} />);

  expect(screen.queryByTestId("offline-banner")).toBeNull();
  expect((screen.getByTestId("mark-all-present") as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByTestId("mark-present-m1") as HTMLButtonElement).disabled).toBe(false);
});
