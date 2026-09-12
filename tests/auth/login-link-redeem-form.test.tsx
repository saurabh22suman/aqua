// @vitest-environment jsdom
//
// Slice 9 — the link page branches: set-PIN vs confirm.
//
// credentialSet=false  -> the set-PIN screen (PIN + confirm PIN);
//                         a mismatch never reaches the network.
// credentialSet=true   -> the familiar confirm screen (regression);
//                         the request carries only the token.
// purpose="reset"      -> the set-PIN screen even though a
//                         credential exists: the owner is replacing
//                         their PIN.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginLinkRedeemForm } from "@/components/login-link-redeem-form";

function expectInDocument(el: HTMLElement | null): void {
  expect(el).not.toBeNull();
  expect(document.body.contains(el)).toBe(true);
}

const BASE_PROPS = {
  token: "tok-123",
  phone: "+919000000001",
  roleKey: "owner",
  tenantName: "Demo Academy",
  expiresAt: "12 Sep, 9:00 am",
};

describe("LoginLinkRedeemForm", () => {
  beforeEach(() => {
    // jsdom refuses real navigation; the component assigns
    // window.location.href on success. Replace it with a spyable
    // stand-in for this suite.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "" },
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the set-PIN fields when no credential exists", () => {
    render(<LoginLinkRedeemForm {...BASE_PROPS} credentialSet={false} purpose="invite" />);
    expectInDocument(screen.getByLabelText("PIN"));
    expectInDocument(screen.getByLabelText("Confirm PIN"));
  });

  it("does not call the network when the PINs mismatch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginLinkRedeemForm {...BASE_PROPS} credentialSet={false} purpose="invite" />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), {
      target: { value: "654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set pin|continue|save/i }));

    await waitFor(() => expectInDocument(screen.getByText(/do not match/i)));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits token + PIN and navigates on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kind: "ok", homePath: "/owner" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginLinkRedeemForm {...BASE_PROPS} credentialSet={false} purpose="invite" />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set pin|continue|save/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/login-link/redeem");
    expect(JSON.parse(String(init.body))).toEqual({ token: "tok-123", pin: "123456" });
    await waitFor(() => expect(window.location.href).toBe("/owner"));
  });

  it("keeps the confirm screen when a credential exists and the purpose is not reset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kind: "ok", homePath: "/coach" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginLinkRedeemForm {...BASE_PROPS} credentialSet purpose="relogin" />);
    expect(document.body.textContent).not.toContain("Confirm PIN");
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ token: "tok-123" });
  });

  it("shows the set-PIN screen for a reset even though a credential exists", () => {
    render(<LoginLinkRedeemForm {...BASE_PROPS} credentialSet purpose="reset" />);
    expectInDocument(screen.getByLabelText("PIN"));
    expectInDocument(screen.getByLabelText("Confirm PIN"));
  });
});
