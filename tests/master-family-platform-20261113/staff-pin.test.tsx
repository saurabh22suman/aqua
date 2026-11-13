// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginLinkRedeemForm } from "@/components/login-link-redeem-form";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  render(<LoginLinkRedeemForm token="synthetic-token" phone="9999999999" roleKey="coach" tenantName="Example club" expiresAt="tomorrow" credentialSet={false} purpose="invite" />);
}

describe("staff invitation PIN privacy", () => {
  it("masks both PIN fields initially and provides an explicit accessible reveal", () => {
    setup();
    const pin = screen.getByLabelText("PIN") as HTMLInputElement;
    const confirmation = screen.getByLabelText("Confirm PIN") as HTMLInputElement;
    expect(pin.type).toBe("password");
    expect(confirmation.type).toBe("password");
    expect(pin.inputMode).toBe("numeric");
    expect(confirmation.autocomplete).toBe("new-password");
    fireEvent.click(screen.getByRole("button", { name: /show pin/i }));
    expect(pin.type).toBe("text");
    expect(screen.getByRole("button", { name: /hide pin/i })).toBeTruthy();
  });

  it("explains mismatched PINs without submitting credentials", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    setup();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Set PIN" }));
    expect(screen.getByRole("alert").textContent).toMatch(/do not match/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
