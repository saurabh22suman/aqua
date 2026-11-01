// @vitest-environment jsdom
//
// Lane a-auth — Task A: PIN recovery outcome handling (request → verify → save).
//
// THE DEFECT UNDER TEST
// `components/whatsapp-auth-form.tsx` had one catch for every phase:
//   setState({ step, error: "Could not complete this request. Please try again." })
// That is wrong in three different ways, and the three phases fail differently:
//
//   1. a LOST SAVE response may hide a committed write (the PIN may now be the
//      live credential and the sessions were revoked server-side). It must be
//      UNKNOWN, never "failed", and it must not invite a blind reset retry —
//      so the PIN fields must not be rendered again;
//   2. a LOST VERIFY response leaves a one-use code in the field (the code may
//      already have been consumed; attempts are capped at five) — the code must
//      not be re-offered;
//   3. a PARSED server error at the save step (the route answers 200
//      {step:"pin", error:...} from its catch) is not a definite outcome either.
//
// The client contract (no string matching, no schema change): 4xx and a 2xx that
// MOVED the flow are definite refusals; no response, 5xx, and a 2xx error that
// stayed on the submitted step at the SAVE phase are UNCERTAIN. See
// docs/audits/staging-blockers-20261029/a-auth/pin-recovery-20261030/THREAT-FLOW.md.
//
// These are rendered behaviour tests (no source-string assertions): each case
// drives the real component through the real phases and asserts what the
// operator is told and what the form still offers.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { WhatsAppAuthForm } from "@/components/whatsapp-auth-form";

const PHONE = "9000000099";
const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Drive the real form to the requested phase. */
async function atPhase(
  phase: "phone" | "code" | "pin",
  purpose: "ops_login" | "pin_reset" = "pin_reset",
) {
  const view = render(<WhatsAppAuthForm purpose={purpose} />);
  if (phase === "phone") return view;
  fetchMock.mockResolvedValueOnce(json({ step: "code" }));
  fireEvent.change(
    view.getByRole("textbox", { name: "Registered mobile number" }),
    { target: { value: PHONE } },
  );
  fireEvent.click(view.getByRole("button", { name: "Send WhatsApp code" }));
  await screen.findByRole("textbox", { name: "6-digit WhatsApp code" });
  if (phase === "code") return view;
  fetchMock.mockResolvedValueOnce(json({ step: "pin" }));
  fireEvent.change(view.getByRole("textbox", { name: "6-digit WhatsApp code" }), {
    target: { value: "123456" },
  });
  fireEvent.click(view.getByRole("button", { name: "Verify code" }));
  await screen.findByLabelText("New PIN");
  return view;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("PIN recovery — a lost request response is unconfirmed, not a failure", () => {
  it("says the request could not be confirmed, keeps the typed number and does not repeat itself", async () => {
    const view = await atPhase("phone");
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));

    fireEvent.change(
      view.getByRole("textbox", { name: "Registered mobile number" }),
      { target: { value: PHONE } },
    );
    fireEvent.click(view.getByRole("button", { name: "Send WhatsApp code" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not confirm/i);
    expect(alert.textContent).toMatch(/Please try again/);
    expect(alert.textContent).not.toMatch(/\bfailed\b/i);

    const phone = view.getByRole("textbox", {
      name: "Registered mobile number",
    }) as HTMLInputElement;
    expect(phone.value).toBe(PHONE);
    expect(phone.closest("fieldset")?.disabled).toBe(false);

    // No automatic repeat write.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("PIN recovery — a lost verify response does not re-offer a one-use code", () => {
  it("reports the outcome as unconfirmed and withdraws the code field", async () => {
    const view = await atPhase("code");
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));

    fireEvent.change(
      view.getByRole("textbox", { name: "6-digit WhatsApp code" }),
      { target: { value: "123456" } },
    );
    fireEvent.click(view.getByRole("button", { name: "Verify code" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not confirm/i);
    expect(alert.textContent).not.toMatch(/\bfailed\b/i);

    // The code may already have been consumed: it must not be offered again.
    expect(
      screen.queryByRole("textbox", { name: "6-digit WhatsApp code" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /request a new code/i }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("PIN recovery — a lost save response is unknown, never saved or failed", () => {
  it("reports the outcome as unconfirmed, withdraws the PIN fields and points at sign-in", async () => {
    const view = await atPhase("pin");
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));

    fireEvent.change(view.getByLabelText("New PIN"), { target: { value: "654321" } });
    fireEvent.change(view.getByLabelText("Re-enter new PIN"), {
      target: { value: "654321" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save PIN" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not confirm/i);
    expect(alert.textContent).not.toMatch(/has been saved/i);
    expect(alert.textContent).not.toMatch(/\bfailed\b/i);

    // Nothing to blind-retry: the PIN fields are gone.
    expect(screen.queryByLabelText("New PIN")).toBeNull();
    expect(screen.queryByLabelText("Re-enter new PIN")).toBeNull();
    expect(
      screen.getByRole("link", { name: /^sign in$/i }).getAttribute("href"),
    ).toBe("/login");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats a parsed server error at the save step as unconfirmed too", async () => {
    const view = await atPhase("pin");
    // The route's catch answers 200 {step:"pin", error:...}: the server did not
    // advance the flow, so the write may or may not have happened.
    fetchMock.mockResolvedValueOnce(
      json({ step: "pin", error: "internal failure detail" }),
    );

    fireEvent.change(view.getByLabelText("New PIN"), { target: { value: "654321" } });
    fireEvent.change(view.getByLabelText("Re-enter new PIN"), {
      target: { value: "654321" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save PIN" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not confirm/i);
    expect(alert.textContent).not.toMatch(/internal failure detail/i);
    expect(screen.queryByLabelText("New PIN")).toBeNull();
    expect(
      screen.getByRole("link", { name: /^sign in$/i }).getAttribute("href"),
    ).toBe("/login");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("PIN recovery — known refusals stay refusals", () => {
  it("shows the expired-challenge refusal and returns to the number step", async () => {
    const view = await atPhase("pin");
    fetchMock.mockResolvedValueOnce(
      json({ step: "phone", error: "Your reset expired. Request a new code." }),
    );

    fireEvent.change(view.getByLabelText("New PIN"), { target: { value: "654321" } });
    fireEvent.change(view.getByLabelText("Re-enter new PIN"), {
      target: { value: "654321" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save PIN" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/reset expired/i);
    expect(alert.textContent).not.toMatch(/could not confirm/i);
    expect(
      screen.getByRole("textbox", { name: "Registered mobile number" }),
    ).toBeTruthy();
  });

  it("shows a known 400 input-validation refusal as a refusal", async () => {
    const view = await atPhase("phone");
    fetchMock.mockResolvedValueOnce(
      json({ step: "phone", error: "Enter a valid mobile number." }, 400),
    );

    fireEvent.change(
      view.getByRole("textbox", { name: "Registered mobile number" }),
      { target: { value: "123" } },
    );
    fireEvent.click(view.getByRole("button", { name: "Send WhatsApp code" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/valid mobile number/i);
    expect(alert.textContent).not.toMatch(/could not confirm/i);
  });

  it("surfaces the Ops refusal instead of masking it as a transport failure", async () => {
    const view = await atPhase("phone", "ops_login");
    fetchMock.mockResolvedValueOnce(
      json({ error: "Sign in with your operator password and authenticator code." }, 403),
    );

    fireEvent.change(
      view.getByRole("textbox", { name: "Registered mobile number" }),
      { target: { value: PHONE } },
    );
    fireEvent.click(view.getByRole("button", { name: "Send WhatsApp code" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/operator password and authenticator/i);
    expect(alert.textContent).not.toMatch(/could not confirm/i);
    // The Ops door never advances into the WhatsApp code step.
    expect(
      screen.queryByRole("textbox", { name: "6-digit WhatsApp code" }),
    ).toBeNull();
  });
});

describe("PIN recovery — success and privacy", () => {
  it("still reports the server's confirmation after a saved PIN", async () => {
    const view = await atPhase("pin");
    fetchMock.mockResolvedValueOnce(
      json({
        step: "done",
        notice: "Your PIN has been saved. Sign in with your new PIN.",
      }),
    );

    fireEvent.change(view.getByLabelText("New PIN"), { target: { value: "654321" } });
    fireEvent.change(view.getByLabelText("Re-enter new PIN"), {
      target: { value: "654321" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save PIN" }));

    expect(
      await screen.findByText(/Your PIN has been saved\. Sign in with your new PIN\./),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /back to sign in/i }).getAttribute("href"),
    ).toBe("/login");
  });

  it("never logs or stores the PIN, the code or the number", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    const sessionSet = vi.spyOn(Storage.prototype, "setItem");

    const view = await atPhase("pin");
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
    fireEvent.change(view.getByLabelText("New PIN"), { target: { value: "654321" } });
    fireEvent.change(view.getByLabelText("Re-enter new PIN"), {
      target: { value: "654321" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save PIN" }));
    await screen.findByRole("alert");

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain("654321");
  });
});
