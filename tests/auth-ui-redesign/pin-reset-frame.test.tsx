// @vitest-environment jsdom
//
// The PIN recovery screen (2026-10-26 review follow-up).
//
// `/login/reset` was still a bare `<main>` with a heading, while
// `/login` had been rebuilt around the AuthShell. The recovery screen
// is the other half of the same journey, so it now uses the same frame.
//
// What must NOT change while it is restyled: the tenant recovery route
// (never the ops one), the WhatsApp request/verify/save steps, the
// generic failure behaviour, and the absence of any invented code.
//
// Scope note: `components/whatsapp-auth-form.tsx` is shared with the
// ops console (`purpose="ops_login"`), so this lane restyles the PAGE
// only and leaves that component alone. The tests below therefore read
// it from the outside: the route it posts to, the fields it offers and
// the steps it walks through.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ResetPinPage from "@/app/login/reset/page";
import LoginPage from "@/app/(auth)/login/page";

describe("PIN recovery screen", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the same frame as the sign-in screen", () => {
    render(<ResetPinPage />);

    // One main landmark, the editorial panel, the brand lockup.
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(
      screen.getByRole("complementary", { name: /about aqua/i }),
    ).toBeTruthy();
    expect(screen.getAllByText("Aqua").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { level: 1, name: /reset your pin/i }),
    ).toBeTruthy();
  });

  it("keeps the way back to sign-in", () => {
    render(<ResetPinPage />);

    const back = screen.getByRole("link", { name: /sign in/i });
    expect(back.getAttribute("href")).toBe("/login");
  });

  it("posts to the tenant recovery route, never the operator one", () => {
    const { container } = render(<ResetPinPage />);

    const form = container.querySelector("form");
    expect(form?.getAttribute("action")).toBe("/api/login/pin-recovery");
    expect(form?.getAttribute("action")).not.toContain("/ops/");
  });

  it("starts with the registered number and asks for no code", () => {
    const { container } = render(<ResetPinPage />);

    expect(
      screen.getByLabelText(/registered mobile number/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /send whatsapp code/i })).toBeTruthy();

    // No invented code, and no code field before one is asked for.
    expect(container.querySelector('input[name="code"]')).toBeNull();
    expect(screen.queryByText(/\d{6}/)).toBeNull();
  });

  it("is reachable from the sign-in screen's recovery link", () => {
    render(<LoginPage />);

    const link = screen.getByRole("link", { name: /forgot pin/i });
    expect(link.getAttribute("href")).toBe("/login/reset");
  });
});
