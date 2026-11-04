// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { status } = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock("@/lib/actions/platform-auth", () => ({ platformAuthStatusAction: status }));
vi.mock("@/app/(platform)/ops/login/login-form", () => ({
  PlatformLoginForm: () => <div data-testid="platform-login-form" />,
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
async function renderLoginPage() {
  vi.resetModules();
  const { default: Page } = await import("@/app/(platform)/ops/login/page");
  return render(await Page());
}
beforeEach(() => {
  status.mockResolvedValue({ kind: "not_found" });
  vi.stubEnv("OPS_EMAIL", undefined); vi.stubEnv("OPS_PASSWORD", undefined);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("Ops password and authenticator entry", () => {
  it("offers the password form for configured credentials without a WhatsApp fallback", async () => {
    vi.stubEnv("OPS_EMAIL", "ops@example.test"); vi.stubEnv("OPS_PASSWORD", "synthetic-twelve-character-password");
    await renderLoginPage();
    expect(screen.getByTestId("platform-login-form")).toBeTruthy();
    expect(screen.queryByText(/WhatsApp/)).toBeNull();
  });
  it("offers the same password form for database credentials", async () => {
    await renderLoginPage();
    expect(screen.getByTestId("platform-login-form")).toBeTruthy();
    expect(screen.getByText(/then confirm with your authenticator code/)).toBeTruthy();
  });
  it("takes a pending password challenge to the authenticator page", async () => {
    status.mockResolvedValue({ kind: "unauthenticated" });
    await expect(renderLoginPage()).rejects.toThrow("REDIRECT:/ops/verify");
  });
  it("takes fully authenticated operators to Ops", async () => {
    status.mockResolvedValue({ kind: "authenticated" });
    await expect(renderLoginPage()).rejects.toThrow("REDIRECT:/ops");
  });
  it("offers a fresh password sign-in after expiry", async () => {
    status.mockResolvedValue({ kind: "expired" });
    await renderLoginPage(); expect(screen.getByTestId("platform-login-form")).toBeTruthy();
  });
});
