// @vitest-environment jsdom
//
// Tenant phone + PIN login — redesign acceptance (2026-10-26, batch 5).
//
// This file is the agent-owned acceptance suite for the login restyle.
// It has two halves:
//
//   1. RED cases — behaviour that does NOT exist in the shipped form
//      today and that the redesign must add: an accessible PIN reveal
//      control, field-level PIN rule feedback, a real label association
//      for the mobile field, a native form (Enter submits, the pending
//      state is exposed), a sign-in that is HELD while unsynced drafts
//      sit on the device, and a branded club entry instead of an
//      unbranded field stack.
//
//   2. Regression guards — behaviour the redesign must NOT change:
//      the phone normalisation, the 6–12 digit PIN rule, the generic
//      error that never discloses whether a number is registered, the
//      role routing, the WhatsApp recovery route, the unsynced-draft
//      discard path and the "no second sign-in path" rule.
//
// The protected suite (tests/auth/login-form.test.tsx) owns the shipped
// contract; this file owns the redesign's new contract. Neither edits
// the other.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── module mocks (same seams the protected suite uses) ──────────────────────

const homeForSessionAction = vi.fn();
vi.mock("@/lib/actions/auth-ui", () => ({
  homeForSessionAction: (...args: unknown[]) => homeForSessionAction(...args),
  devCodeAction: vi.fn(),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const syncBeforeLogout = vi.fn();
const clearOfflineData = vi.fn();
vi.mock("@/lib/offline/logout", () => ({
  syncBeforeLogout: (...args: unknown[]) => syncBeforeLogout(...args),
}));
vi.mock("@/lib/offline/client-session", () => ({
  clearOfflineData: (...args: unknown[]) => clearOfflineData(...args),
  runOfflineLifecycle: (work: () => Promise<unknown>) => work(),
}));

import { LoginForm } from "@/components/login-form";
import LoginPage from "@/app/(auth)/login/page";

// ── helpers ────────────────────────────────────────────────────────────────

const PHONE_PLACEHOLDER = "+91 98765 43210";

function phoneInput(): HTMLInputElement {
  return screen.getByPlaceholderText(PHONE_PLACEHOLDER) as HTMLInputElement;
}

function pinInput(): HTMLInputElement {
  return screen.getByLabelText("PIN") as HTMLInputElement;
}

function signInButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^sign in$/i }) as HTMLButtonElement;
}

function fillCredentials(phone = "9876543210", pin = "123456"): void {
  fireEvent.change(phoneInput(), { target: { value: phone } });
  fireEvent.change(pinInput(), { target: { value: pin } });
}

function okResponse(): Response {
  return new Response(JSON.stringify({ kind: "ok" }), { status: 200 });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function enableOfflineBranch(): void {
  // The form only consults the offline queue when the browser really
  // has one. jsdom has neither IndexedDB nor a service worker, so the
  // branch is entered by declaring both.
  vi.stubGlobal("indexedDB", {});
  Object.defineProperty(navigator, "serviceWorker", {
    value: {},
    configurable: true,
  });
}

function disableOfflineBranch(): void {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
}

// ── suite ──────────────────────────────────────────────────────────────────

describe("tenant login redesign", () => {
  beforeEach(() => {
    push.mockReset();
    homeForSessionAction.mockReset();
    syncBeforeLogout.mockReset();
    clearOfflineData.mockReset();
    disableOfflineBranch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  // ── RED 1 — accessible PIN reveal ───────────────────────────────────────

  it("RED: offers an accessible way to reveal the PIN and to hide it again", () => {
    render(<LoginForm />);

    expect(pinInput().type).toBe("password");

    const show = screen.getByRole("button", { name: /show pin/i });
    fireEvent.click(show);

    expect(pinInput().type).toBe("text");
    const hide = screen.getByRole("button", { name: /hide pin/i });
    fireEvent.click(hide);

    expect(pinInput().type).toBe("password");
  });

  it("RED: the PIN reveal control is a real button that does not submit the form", () => {
    render(<LoginForm />);
    const toggle = screen.getByRole("button", { name: /show pin/i });

    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.getAttribute("aria-controls")).toBe(pinInput().id);
  });

  // ── RED 2 — field-level PIN rule feedback ───────────────────────────────

  it("RED: explains the PIN rule at the field once a too-short PIN loses focus", () => {
    render(<LoginForm />);

    fireEvent.change(pinInput(), { target: { value: "123" } });
    fireEvent.blur(pinInput());

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/6 to 12 digits/i);
    expect(pinInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("RED: does not cry wolf when the PIN is valid", () => {
    render(<LoginForm />);

    fireEvent.change(pinInput(), { target: { value: "123456" } });
    fireEvent.blur(pinInput());

    expect(screen.queryByRole("alert")).toBeNull();
    expect(pinInput().getAttribute("aria-invalid")).toBeNull();
  });

  // ── RED 3 — real label association ─────────────────────────────────────

  it("RED: associates the mobile field with a real label element", () => {
    render(<LoginForm />);

    const input = phoneInput();
    expect(input.id).toBeTruthy();

    const label = document.querySelector(`label[for="${input.id}"]`);
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("Mobile number");

    expect(input.getAttribute("inputmode")).toBe("tel");
    expect(input.getAttribute("autocomplete")).toBe("tel");
  });

  it("RED: keeps the PIN field masked, numeric and at most twelve characters", () => {
    render(<LoginForm />);

    const input = pinInput();
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("current-password");
    expect(input.getAttribute("maxlength")).toBe("12");
    expect(input.className).toMatch(/text-\[16px\]|text-\[20px\]/);
  });

  // ── RED 4 — a real form ────────────────────────────────────────────────

  it("RED: wraps the credentials in a native form that submits on Enter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    homeForSessionAction.mockResolvedValue({ kind: "ok", path: "/owner" });

    const { container } = render(<LoginForm />);
    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    fillCredentials();
    fireEvent.keyDown(pinInput(), { key: "Enter" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/owner"));
  });

  it("RED: exposes the pending state to assistive technology", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    homeForSessionAction.mockResolvedValue({ kind: "ok", path: "/owner" });

    const { container } = render(<LoginForm />);
    const form = container.querySelector("form")!;
    // Captured before the click: while the request is in flight the
    // button's label is the pending one, not "Sign in".
    const button = signInButton();

    fillCredentials();
    fireEvent.click(button);

    await waitFor(() => expect(form.getAttribute("aria-busy")).toBe("true"));
    expect(button.disabled).toBe(true);

    pending.resolve(okResponse());
    await waitFor(() => expect(form.getAttribute("aria-busy")).toBe("false"));
  });

  // ── RED 5 — the sign-in is HELD by unsynced drafts ─────────────────────

  it("RED: holds the sign-in while unsynced attendance drafts are on the device", async () => {
    enableOfflineBranch();
    syncBeforeLogout.mockResolvedValue(3);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginForm />);
    fillCredentials();
    fireEvent.click(signInButton());

    await waitFor(() =>
      expect(screen.getByText(/unsynced attendance marks/i)).toBeTruthy(),
    );
    // No credential request went out while the drafts were pending.
    expect(fetchMock).not.toHaveBeenCalled();
    // And the primary action is not a way past the hold.
    expect(signInButton().disabled).toBe(true);
  });

  // ── RED 6 — a branded club entry ───────────────────────────────────────

  it("RED: presents the entry with a brand lockup and a club editorial panel", () => {
    render(<LoginPage />);

    expect(screen.getAllByText("Aqua").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("complementary", { name: /about aqua/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: /sign in/i }),
    ).toBeTruthy();
  });

  it("RED: keeps the sports identity restrained — no photo, no dashboard cards", () => {
    const { container } = render(<LoginPage />);

    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
    // No third-party sign-in, no pricing, no social proof.
    expect(screen.queryByText(/free trial|subscription|pricing|per month/i)).toBeNull();
  });

  // ── guards — behaviour the redesign must preserve ──────────────────────

  it("keeps a generic error on a bad credential and keeps what was typed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ kind: "error", code: "invalid_credentials" }), {
          status: 401,
        }),
      ),
    );

    render(<LoginForm />);
    fillCredentials("9876543210", "000000");
    fireEvent.click(signInButton());

    await waitFor(() =>
      expect(screen.getByText(/wrong number or pin/i)).toBeTruthy(),
    );
    // The message never says which of the two was wrong.
    expect(screen.queryByText(/pin is wrong|number not registered|unknown number/i)).toBeNull();
    expect(phoneInput().value).toBe("9876543210");
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps the role routing to the session's home", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
    homeForSessionAction.mockResolvedValue({ kind: "ok", path: "/coach" });

    render(<LoginForm />);
    fillCredentials();
    fireEvent.click(signInButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/coach"));
  });

  it("keeps the paused-club and no-club messages distinct", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    homeForSessionAction.mockResolvedValue({
      kind: "suspended",
      tenantSlugs: ["demo-academy"],
    });

    render(<LoginForm />);
    fillCredentials();
    fireEvent.click(signInButton());

    await waitFor(() => expect(screen.getByText(/demo-academy/)).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps the 'no club found' message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    homeForSessionAction.mockResolvedValue({ kind: "none" });

    render(<LoginForm />);
    fillCredentials();
    fireEvent.click(signInButton());

    await waitFor(() =>
      expect(screen.getByText(/no club found for this number/i)).toBeTruthy(),
    );
  });

  it("keeps the phone normalisation — a bare ten-digit mobile becomes +91", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    homeForSessionAction.mockResolvedValue({ kind: "ok", path: "/owner" });

    render(<LoginForm />);
    fillCredentials("9876543210", "123456");
    fireEvent.click(signInButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/login/pin");
    expect(JSON.parse(String(init.body))).toEqual({
      phone: "+919876543210",
      pin: "123456",
    });
  });

  it("keeps the canonical +91 form visible after the field loses focus", () => {
    render(<LoginForm />);
    fireEvent.change(phoneInput(), { target: { value: "9876543210" } });
    fireEvent.blur(phoneInput());

    expect(phoneInput().value).toBe("+91 98765 43210");
  });

  it("keeps the PIN numeric and the action locked until it is usable", () => {
    render(<LoginForm />);

    // Letters are dropped, the digits are kept in order.
    fireEvent.change(pinInput(), { target: { value: "12a34b6" } });
    expect(pinInput().value).toBe("12346");

    fireEvent.change(pinInput(), { target: { value: "12345" } });
    expect(signInButton().disabled).toBe(true);

    fireEvent.change(pinInput(), { target: { value: "123456" } });
    expect(signInButton().disabled).toBe(true); // no phone yet

    fireEvent.change(phoneInput(), { target: { value: "9876543210" } });
    expect(signInButton().disabled).toBe(false);
  });

  it("keeps the WhatsApp recovery route", () => {
    render(<LoginPage />);
    const link = screen.getByRole("link", { name: /forgot pin/i });
    expect(link.getAttribute("href")).toBe("/login/reset");
    expect(link.textContent).toMatch(/reset with whatsapp/i);
  });

  it("keeps the unsynced-draft discard as an explicit, separate choice", async () => {
    enableOfflineBranch();
    syncBeforeLogout.mockResolvedValue(2);
    clearOfflineData.mockResolvedValue(true);
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    homeForSessionAction.mockResolvedValue({ kind: "ok", path: "/owner" });

    render(<LoginForm />);
    fillCredentials();
    fireEvent.click(signInButton());

    await waitFor(() =>
      expect(screen.getByText(/unsynced attendance marks/i)).toBeTruthy(),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /discard drafts and continue/i }),
    );

    await waitFor(() => expect(clearOfflineData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/owner"));
  });

  it("offers a cancel that steps back without discarding anything", async () => {
    enableOfflineBranch();
    syncBeforeLogout.mockResolvedValue(2);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginForm />);
    fillCredentials();
    fireEvent.click(signInButton());

    await waitFor(() =>
      expect(screen.getByText(/unsynced attendance marks/i)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel sign-in/i }));

    await waitFor(() =>
      expect(screen.queryByText(/unsynced attendance marks/i)).toBeNull(),
    );
    expect(clearOfflineData).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers no second sign-in path", () => {
    render(<LoginPage />);

    expect(
      screen.queryByRole("button", {
        name: /google|facebook|apple|one[- ]time|otp/i,
      }),
    ).toBeNull();
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
    expect(screen.queryByText(/sign in with/i)).toBeNull();
  });

  it("keeps the new auth components on design tokens only", () => {
    const root = join(process.cwd(), "components", "auth");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) files.push(full);
      }
    };
    // A missing directory is a setup state, not a failure — the guard
    // only has something to say once the components exist.
    if (!existsSync(root)) return;
    walk(root);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // No hardcoded hex colours — the palette is themed (DESIGN.md §1.1).
      expect(source, `${file} must not hardcode a hex colour`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b/,
      );
      // The reserved status tokens are money/attendance only.
      expect(source, `${file} must not use a reserved status token`).not.toMatch(
        /(?<![\w-])(?:bg|text|border|ring|from|to|via)-(?:good|late|warn)(?![\w-])/,
      );
    }
  });
});
