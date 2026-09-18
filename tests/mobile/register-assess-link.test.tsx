// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// V-10 — the register's tap-to-assess entry. A coach reaches the
// one-tap band board from the session register without leaving the
// attendance flow; the row link carries the session id so the back
// link returns to the register.

vi.mock("@/lib/hooks/use-offline-register", () => ({
  useOfflineRegister: () => ({
    marks: {},
    mark: vi.fn(),
    markedCount: 0,
    pending: 0,
    online: true,
    savedAtLabel: null,
    hasActiveFailure: false,
    saving: 0,
    waitForPendingWrites: vi.fn(),
    retrySync: vi.fn(),
  }),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

import { RegisterBoard } from "@/components/register-board";

const ROWS = [
  {
    memberId: "m1",
    name: "Anu",
    code: "M1",
    status: null,
    pct: 80,
    isTrial: false,
  },
];

afterEach(cleanup);

describe("register assess link (V-10)", () => {
  it("links each row to the assess board for that member and session", () => {
    render(
      <RegisterBoard sessionId="s-1" rows={ROWS} offlineSyncEnabled={false} />,
    );
    const link = screen.getByTestId("assess-m1");
    expect(link.getAttribute("href")).toBe(
      "/coach/members/m1/assess?sessionId=s-1",
    );
    expect(link.textContent).toContain("Assess");
  });
});
