// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The current Ops door is the password form, independently of env operator
// configuration. An authenticated or partially authenticated session redirects
// before rendering; the retired WhatsApp door must not reappear.
const auth = vi.hoisted(() => ({ kind: "not_found" }));

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({ kind: auth.kind }),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/app/(platform)/ops/login/login-form", () => ({
  PlatformLoginForm: () => <div data-testid="platform-login-form" />,
}));
vi.mock("@/components/whatsapp-auth-form", () => ({
  WhatsAppAuthForm: () => <div data-testid="whatsapp-auth-form" />,
}));

async function renderLoginPage() {
  // lib/env.ts parses process.env at import time, so the variables
  // have to be in place before the page (and its env import) are
  // loaded. resetModules + a dynamic import is the same trick
  // tests/env.test.ts uses for the same reason.
  vi.resetModules();
  const { default: PlatformLoginPage } = await import(
    "@/app/(platform)/ops/login/page"
  );
  const Page = PlatformLoginPage as unknown as () => Promise<
    React.ReactElement
  >;
  return render(await Page());
}

describe("platform login page — the env operator door", () => {
  beforeEach(() => {
    auth.kind = "not_found";
    vi.stubEnv("OPS_EMAIL", undefined);
    vi.stubEnv("OPS_PASSWORD", undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("offers the env door when the deployment configures it", async () => {
    vi.stubEnv("OPS_EMAIL", "ops@thepreprabbit.in");
    vi.stubEnv("OPS_PASSWORD", "a-twelve-character-secret");
    await renderLoginPage();
    expect(screen.getByTestId("platform-login-form")).toBeTruthy();
  });

  it("does not render the retired WhatsApp door", async () => {
    vi.stubEnv("OPS_EMAIL", "ops@thepreprabbit.in");
    vi.stubEnv("OPS_PASSWORD", "a-twelve-character-secret");
    await renderLoginPage();
    expect(screen.queryByTestId("whatsapp-auth-form")).toBeNull();
  });

  it("offers the operator password form even without env credentials", async () => {
    await renderLoginPage();
    expect(screen.getByTestId("platform-login-form")).toBeTruthy();
    expect(screen.queryByTestId("whatsapp-auth-form")).toBeNull();
  });

  it.each([["authenticated", "/ops"], ["unauthenticated", "/ops/verify"]])(
    "redirects %s before rendering the login form", async (kind, destination) => {
      auth.kind = kind;
      await expect(renderLoginPage()).rejects.toThrow(`REDIRECT:${destination}`);
      expect(screen.queryByTestId("platform-login-form")).toBeNull();
    },
  );
});
