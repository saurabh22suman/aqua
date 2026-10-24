// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The platform (ops) login must offer the ENV operator door.
//
// The backend has had it since "env-only ops login" (slices 1/12 +
// 11/12): when OPS_EMAIL + OPS_PASSWORD are set, db/platform-auth.ts
// routes the platform login to db/platform-auth-env.ts, the password
// is compared in constant time and the session is created fully
// authenticated — no TOTP, no registered operator phone, no WhatsApp
// message.
//
// The WhatsApp form replaced the email + password form on this page
// and left app/(platform)/ops/login/login-form.tsx in the tree
// unrendered. The door was therefore unreachable from the browser:
// a deployment that set the variables had a working door in the code
// and no way through it. This test pins that the page offers the
// env door exactly when the deployment configures it.

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({ kind: "unauthenticated" }),
}));
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

  it("keeps the WhatsApp door alongside it", async () => {
    vi.stubEnv("OPS_EMAIL", "ops@thepreprabbit.in");
    vi.stubEnv("OPS_PASSWORD", "a-twelve-character-secret");
    await renderLoginPage();
    expect(screen.getByTestId("whatsapp-auth-form")).toBeTruthy();
  });

  it("does not offer the env door when the deployment does not configure it", async () => {
    await renderLoginPage();
    expect(screen.queryByTestId("platform-login-form")).toBeNull();
    expect(screen.getByTestId("whatsapp-auth-form")).toBeTruthy();
  });
});
