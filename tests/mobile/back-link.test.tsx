// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// Phase 4 (mobile UX plan v2) — F13. Five detail pages had no way
// back; three more hand-rolled the same link. One component with the
// canonical classes and a 44px row.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown }) => {
      const { href, children, ...rest } = props as {
        href?: unknown;
        children?: unknown;
        [k: string]: unknown;
      };
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as ReactNode,
      );
    },
  };
});

import { BackLink } from "@/components/ui/BackLink";

afterEach(cleanup);

describe("BackLink", () => {
  it("renders an anchor to the target with the label", () => {
    render(<BackLink href="/owner/members" label="Members" />);
    const link = screen.getByText("Members").closest("a");
    expect(link?.getAttribute("href")).toBe("/owner/members");
  });

  it("carries the 44px minimum row height", () => {
    render(<BackLink href="/coach/members" label="Members" />);
    const link = screen.getByText("Members").closest("a");
    expect(link?.className).toContain("min-h-11");
    expect(link?.className).toContain("inline-flex");
  });
});
