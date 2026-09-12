// @vitest-environment jsdom
//
// Slice 8 — phone + PIN login form.
//
// The login page moves from phone -> OTP code to phone + PIN (the
// credential set on first magic-link redemption). OTP endpoints stay
// in the codebase for when a delivery channel lands; the UI no longer
// surfaces them.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const homeForSessionAction = vi.fn();
vi.mock("@/lib/actions/auth-ui", () => ({
  homeForSessionAction: (...args: unknown[]) => homeForSessionAction(...args),
  devCodeAction: vi.fn(),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { LoginForm } from "@/components/login-form";

function expectInDocument(el: HTMLElement | null): void {
  expect(el).not.toBeNull();
  expect(document.body.contains(el)).toBe(true);
}

describe("LoginForm (phone + PIN)", () => {
  beforeEach(() => {
    push.mockReset();
    homeForSessionAction.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a phone field and a PIN field", () => {
    render(<LoginForm />);
    expectInDocument(screen.getByPlaceholderText("+91 98765 43210"));
    expectInDocument(screen.getByLabelText("PIN"));
  });

  it("posts the normalised phone + PIN and routes to the role home", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kind: "ok" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    homeForSessionAction.mockResolvedValue({ kind: "ok", path: "/owner" });

    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText("+91 98765 43210"), {
      target: { value: "+91 98765-43210" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/login/pin");
    expect(JSON.parse(String(init.body))).toEqual({
      phone: "+919876543210",
      pin: "123456",
    });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/owner"));
  });

  it("shows a generic error on a 401 and does not navigate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ kind: "error", code: "invalid_credentials" }), {
          status: 401,
        }),
      ),
    );
    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText("+91 98765 43210"), {
      target: { value: "9876543210" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expectInDocument(screen.getByText(/wrong number or pin/i)),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("names the suspended tenant when the session resolves to a paused club", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    homeForSessionAction.mockResolvedValue({
      kind: "suspended",
      tenantSlugs: ["demo-academy"],
    });
    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText("+91 98765 43210"), {
      target: { value: "9876543210" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expectInDocument(screen.getByText(/demo-academy/)));
    expect(push).not.toHaveBeenCalled();
  });

  it("reports the no-membership case without claiming a wrong PIN", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    homeForSessionAction.mockResolvedValue({ kind: "none" });
    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText("+91 98765 43210"), {
      target: { value: "9876543210" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expectInDocument(screen.getByText(/no club found for this number/i)),
    );
  });
});
