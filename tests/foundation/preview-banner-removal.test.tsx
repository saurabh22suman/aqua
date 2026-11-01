// @vitest-environment jsdom
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// UI foundation — the synthetic preview strip leaves the root layout.
//
// The human saw the "Synthetic preview …" strip at the top of the local
// demo and asked for it to be removed. That strip was the root
// layout's own inline notice for a preview deployment stage
// (app/layout.tsx).
//
// Nothing else moves with it: the deployment stage, the messaging
// provider and the disabled/mock message delivery stay exactly as they
// are, and the DISTINCT DemoBanner (a real club's demo state, a
// different surface with different rules) is not its business.
//
// What this pins:
//
//   * a preview stage renders NO synthetic preview status and no
//     preview banner — with the mock messaging provider AND with the
//     capture messaging provider;
//   * the layout still renders the app's own children, the resolved
//     theme, the demo banner slot and the service worker registrar.
//
// The environment is stubbed, so this suite never imports the real
// lib/env and never touches a database URL, a credential or the
// network. The layout's own output is rendered and read — no class
// string is asserted.
//
// RED status: the root layout still renders the inline strip, so the
// "no preview status" cases fail on the current source.

const { envState, themeState } = vi.hoisted(() => ({
  envState: {
    AQUA_DEPLOYMENT_STAGE: "preview",
    WHATSAPP_PROVIDER: "mock",
  } as { AQUA_DEPLOYMENT_STAGE: string; WHATSAPP_PROVIDER: string },
  themeState: { theme: "" },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/env", () => ({ env: envState }));

// The theme provider is observed, not replaced: the stub records the
// preset the layout resolved and renders its children.
vi.mock("@/components/theme/theme-provider", () => ({
  ThemeProvider: ({
    theme,
    children,
  }: {
    theme: string;
    children: ReactNode;
  }) => {
    themeState.theme = theme;
    return (
      <div data-testid="theme-provider-slot" data-theme={theme}>
        {children}
      </div>
    );
  },
}));

vi.mock("@/components/demo-banner", () => ({
  DemoBanner: () => <div data-testid="demo-banner-slot" />,
}));

// The registrar is a client component that touches the service worker
// and the router; the layout's SLOT for it is what this suite reads.
vi.mock("@/components/sw-registrar", () => ({
  ServiceWorkerRegistrar: () => <span data-testid="sw-registrar-slot" />,
}));

import RootLayout from "@/app/layout";

async function renderLayout(): Promise<string> {
  const element = await RootLayout({
    children: <div data-testid="app-child">the app&apos;s own page</div>,
  });
  return renderToStaticMarkup(element);
}

describe("the root layout's synthetic preview notice", () => {
  it("renders no preview status on a preview stage with mock messaging", async () => {
    envState.AQUA_DEPLOYMENT_STAGE = "preview";
    envState.WHATSAPP_PROVIDER = "mock";

    const markup = await renderLayout();

    expect(markup).not.toContain("preview-banner");
    expect(markup).not.toContain("Synthetic preview");
    expect(markup).not.toContain('role="status"');
  });

  it("renders no preview status on a preview stage with capture messaging", async () => {
    envState.AQUA_DEPLOYMENT_STAGE = "preview";
    envState.WHATSAPP_PROVIDER = "capture";

    const markup = await renderLayout();

    expect(markup).not.toContain("preview-banner");
    expect(markup).not.toContain("Synthetic preview");
    expect(markup).not.toContain("Messages are captured");
  });

  it("keeps the app's own children, the theme and the foundation slots", async () => {
    envState.AQUA_DEPLOYMENT_STAGE = "preview";
    envState.WHATSAPP_PROVIDER = "mock";

    const markup = await renderLayout();

    expect(markup).toContain('data-testid="app-child"');
    expect(markup).toContain('data-testid="theme-provider-slot"');
    expect(markup).toContain('data-theme="mint"');
    expect(themeState.theme).toBe("mint");
    expect(markup).toContain('data-testid="demo-banner-slot"');
    expect(markup).toContain('data-testid="sw-registrar-slot"');
  });

  it("renders the same shell outside a preview stage", async () => {
    envState.AQUA_DEPLOYMENT_STAGE = "development";
    envState.WHATSAPP_PROVIDER = "mock";

    const markup = await renderLayout();

    expect(markup).not.toContain("preview-banner");
    expect(markup).toContain('data-testid="app-child"');
    expect(markup).toContain('data-testid="sw-registrar-slot"');
  });
});
