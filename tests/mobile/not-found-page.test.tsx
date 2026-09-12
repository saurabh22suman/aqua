// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// P0-2 (mobile UX audit, 2026-09-12) — the app had no not-found.tsx, so
// every notFound() (the /parent role gate, and now the malformed-id
// guard) rendered Next's bare black-and-white 404 with no branding and
// no way back. The friendly page is the root boundary for all of them.

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

import NotFound from "@/app/not-found";

afterEach(cleanup);

describe("root not-found page (P0-2)", () => {
  it("renders branded, friendly copy instead of Next's bare 404", () => {
    render(<NotFound />);
    expect(screen.getByTestId("not-found-page")).toBeTruthy();
    expect(screen.getByText(/couldn't find that page/i)).toBeTruthy();
    expect(screen.getByText(/link may be broken|page may have moved/i)).toBeTruthy();
  });

  it("offers a way back to sign in", () => {
    render(<NotFound />);
    const link = screen.getByRole("link", { name: /sign in/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/login");
  });
});
