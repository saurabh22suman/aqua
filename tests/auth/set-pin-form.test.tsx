// @vitest-environment jsdom
//
// Set-PIN safety net form (slice 7 page half).
//
// Reached when a session exists but no credential does; posts to
// /api/account/set-pin and routes to the role home.

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

import { SetPinForm } from "@/components/set-pin-form";

function expectInDocument(el: HTMLElement | null): void {
  expect(el).not.toBeNull();
  expect(document.body.contains(el)).toBe(true);
}

describe("SetPinForm", () => {
  beforeEach(() => {
    push.mockReset();
    homeForSessionAction.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders PIN and Confirm PIN fields", () => {
    render(<SetPinForm />);
    expectInDocument(screen.getByLabelText("PIN"));
    expectInDocument(screen.getByLabelText("Confirm PIN"));
  });

  it("a mismatch is a local error and never hits the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SetPinForm />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), {
      target: { value: "654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save pin|set pin/i }));
    await waitFor(() => expectInDocument(screen.getByText(/do not match/i)));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on success posts the PIN and routes to the role home", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ kind: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    homeForSessionAction.mockResolvedValue({ kind: "ok", path: "/coach" });

    render(<SetPinForm />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save pin|set pin/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/account/set-pin");
    expect(JSON.parse(String(init.body))).toEqual({ pin: "123456" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/coach"));
  });

  it("a 409 says a PIN already exists and does not navigate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ kind: "error", code: "already_set" }), {
          status: 409,
        }),
      ),
    );
    render(<SetPinForm />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save pin|set pin/i }));
    await waitFor(() => expectInDocument(screen.getByText(/already set/i)));
    expect(push).not.toHaveBeenCalled();
  });
});
