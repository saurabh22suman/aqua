// @vitest-environment jsdom
//
// Keyboard semantics of the tenant login (2026-10-26 review follow-up).
//
// A coordinator review found a blocking bug: the form carried a
// form-wide `onKeyDown` handler, so Enter was intercepted from EVERY
// descendant of the form — including the type=button Show/Hide PIN
// control. With usable credentials, pressing Enter on that control
// signed the person in instead of revealing the PIN; with unusable
// credentials, the handler still called `preventDefault()`, which
// blocked the button's own keyboard activation entirely.
//
// The contract these tests pin:
//
//   * Enter belongs to the focused control. A control that is not a
//     credential field keeps its native keyboard behaviour — its
//     keydown default is never swallowed.
//   * Enter in a credential field goes through the FORM's own submit
//     event (native form semantics), exactly once.
//   * Enter during IME composition is a composition keystroke, not a
//     submission.
//   * The unsynced-draft hold and the unusable-credentials state
//     still send no credential request, by whatever route the user
//     presses Enter.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

function phoneInput(): HTMLInputElement {
  return screen.getByPlaceholderText("+91 98765 43210") as HTMLInputElement;
}

function pinInput(): HTMLInputElement {
  return screen.getByLabelText("PIN") as HTMLInputElement;
}

function revealToggle(): HTMLElement {
  return screen.getByRole("button", { name: /show pin/i });
}

function fillCredentials(phone = "9876543210", pin = "123456"): void {
  fireEvent.change(phoneInput(), { target: { value: phone } });
  fireEvent.change(pinInput(), { target: { value: pin } });
}

/** Dispatch a keydown the way the browser does, composition state included. */
function pressEnter(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function enableOfflineBranch(): void {
  vi.stubGlobal("indexedDB", {});
  Object.defineProperty(navigator, "serviceWorker", {
    value: {},
    configurable: true,
  });
}

describe("login keyboard semantics", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    push.mockReset();
    homeForSessionAction.mockReset();
    syncBeforeLogout.mockReset();
    clearOfflineData.mockReset();
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kind: "ok" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    homeForSessionAction.mockResolvedValue({ kind: "ok", path: "/owner" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  // ── the bug: Enter on a control inside the form ────────────────────────

  it("does not sign in when Enter is pressed on the PIN reveal control", () => {
    render(<LoginForm />);
    fillCredentials();

    pressEnter(revealToggle());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the reveal control's own keyboard activation intact", () => {
    render(<LoginForm />);
    fillCredentials();

    const event = pressEnter(revealToggle());

    // Not prevented => the browser still activates the button.
    expect(event.defaultPrevented).toBe(false);
  });

  it("still reveals the PIN when the control is clicked", () => {
    render(<LoginForm />);
    fillCredentials();

    fireEvent.click(revealToggle());

    expect(pinInput().type).toBe("text");
  });

  // ── native form submit semantics ───────────────────────────────────────

  it("routes Enter in a credential field through the form's submit event", async () => {
    const { container } = render(<LoginForm />);
    const form = container.querySelector("form")!;
    let submits = 0;
    form.addEventListener("submit", (event) => {
      submits += 1;
      event.preventDefault();
    });

    fillCredentials();
    pressEnter(pinInput());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submits).toBe(1);
  });

  it("submits exactly once when Enter is pressed in a credential field", async () => {
    render(<LoginForm />);
    fillCredentials();

    pressEnter(phoneInput());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── IME composition ─────────────────────────────────────────────────────

  it("does not submit while an IME composition is open", () => {
    render(<LoginForm />);
    fillCredentials();

    const event = pressEnter(pinInput(), { isComposing: true });

    expect(fetchMock).not.toHaveBeenCalled();
    // The composition keystroke must reach the IME.
    expect(event.defaultPrevented).toBe(false);
  });

  // ── controls outside the credential fields ──────────────────────────────

  it("does not intercept Enter on the recovery link", () => {
    render(<LoginForm />);
    fillCredentials();

    const link = screen.getByRole("link", { name: /forgot pin/i });
    const event = pressEnter(link);

    expect(event.defaultPrevented).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── states that must not send a credential request ─────────────────────

  it("sends nothing when Enter is pressed with an unusable PIN", () => {
    render(<LoginForm />);
    fillCredentials("9876543210", "123");

    pressEnter(pinInput());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when Enter is pressed while unsynced drafts hold the sign-in", async () => {
    enableOfflineBranch();
    syncBeforeLogout.mockResolvedValue(3);
    render(<LoginForm />);
    fillCredentials();

    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    await waitFor(() =>
      expect(screen.getByText(/unsynced attendance marks/i)).toBeTruthy(),
    );

    pressEnter(pinInput());

    expect(fetchMock).not.toHaveBeenCalled();
    // The hold is still standing.
    expect(screen.getByText(/unsynced attendance marks/i)).toBeTruthy();
  });
});
