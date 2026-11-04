// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Branding settings — ONE authoritative live draft preview.
//
// The page used to add a second, static "Identity preview" card beside the
// form's own live preview, so a desktop capture showed two competing marks.
// The form owns the live preview; the page composition must render it once.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["settings.manage"]),
    features: new Set<string>(),
  }),
  requirePagePermission: (value: unknown) => value,
}));

vi.mock("@/lib/actions/branding", () => ({
  getBrandingAction: async () => ({
    displayName: "Splash Sports Club",
    shortName: "Splash",
    accent: "mango",
    fallbackDisplayName: "Splash Sports Club",
    fallbackShortName: "Splash",
    initials: "SS",
  }),
  updateBrandingAction: async () => ({ ok: true }),
}));

import BrandingSettingsPage from "@/app/(owner)/owner/settings/branding/page";

afterEach(cleanup);

describe("branding page composition", () => {
  it("renders a single live draft preview, not a competing static card", async () => {
    render(await BrandingSettingsPage());

    expect(screen.getAllByText("Splash Sports Club")).toHaveLength(1);
  });

  it("keeps the draft preview updating with the form values", async () => {
    render(await BrandingSettingsPage());

    fireEvent.change(screen.getByTestId("branding-display-name"), {
      target: { value: "Worli Aquatics" },
    });

    expect(screen.getAllByText("Worli Aquatics")).toHaveLength(1);
    expect(screen.queryByText("Splash Sports Club")).toBeNull();
  });
});
