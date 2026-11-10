"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { PinField } from "@/components/auth/pin-field";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/FieldError";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  ALLOWED_HOME_PATHS,
  PIN_RULE,
  focusField,
  homePathFor,
  submitOnEnter,
  type SelfAudience,
} from "@/components/self-access-form";

// THE MEMBER AND FAMILY INVITATION FORM.
//
// The club's invitation link carries its code in the URL FRAGMENT
// (#token=...). The fragment is read in the BROWSER, never in a server
// render, never in a query string, never in a request path and never in
// a log. A fragment is not sent to the server at all, so the code
// reaches the server only in the activation request's body.
//
// THE PERSON CHOOSES A PIN, OR USES THE ONE THEY HAVE. The door verifies
// an existing PIN and creates the first one when there is none; it never
// resets a PIN. The confirmation is checked BEFORE the request goes out.
//
// EVERY REFUSAL IS ONE MESSAGE. The door answers a wrong PIN, a spent
// link, an unknown invitation and a throttled attempt with the same
// refusal, so this form cannot tell the person which one it was — and
// the code stays available for a retry.
//
// ON SUCCESS THE CODE LEAVES THE ADDRESS BAR. It is cleared from THIS
// history entry before the navigation, so a spent invitation is not left
// in the Back history of a shared device.
//
// A BROKEN CODE IS AN UNUSABLE INVITATION, NOT A CRASH. A fragment can
// carry a broken percent escape ("#token=%"), and decoding one throws.
// The code is then unreadable, which is the same thing to this form as no
// code at all: the existing missing-code panel asks the person for a
// fresh link. Nothing is thrown and nothing is logged.
//
// There is no reset flow, no message code and no "verified" claim: the
// link is the invitation, and the PIN is the only thing chosen here.

/** The invitation code lives in the URL FRAGMENT, never in a query. */
function readTokenFromFragment(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of raw.split("&")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index) !== "token") continue;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(index + 1)).trim();
    } catch {
      // A BROKEN PERCENT ESCAPE IS NOT A CODE. It cannot be decoded, so
      // the invitation is unusable — and an unusable invitation is what
      // this form already shows a person for. Nothing is logged.
      return null;
    }
    if (value.length > 0) return value;
  }
  return null;
}

export function SelfInvitationForm({ audience }: { audience: SelfAudience }) {
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [pinBlurred, setPinBlurred] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(readTokenFromFragment(window.location.hash));
    setTokenReady(true);
  }, []);

  const pinValid = PIN_RULE.test(pin);
  const pinError =
    pinBlurred && pin.length > 0 && !pinValid
      ? "Your PIN needs 6 to 12 digits."
      : null;
  const confirmMismatch = confirm.length > 0 && confirm !== pin;
  const canSubmit = token !== null && pinValid && confirm === pin && !busy;

  async function submit(): Promise<void> {
    if (busy || token === null) return;
    setError(null);
    setBusy(true);
    // Set once the door has opened: the page is on its way out, so the
    // action stays busy and the form never claims the code is missing
    // while it is leaving.
    let leaving = false;
    try {
      const response = await fetch("/api/self/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, pin }),
      });
      if (!response.ok) {
        setError(
          "We could not open this account. Check the PIN you entered, or ask your club for a fresh invitation link.",
        );
        focusField("invite-pin");
        return;
      }
      const data = (await response.json()) as {
        kind?: string;
        homePath?: string;
      };
      const home = data.homePath;
      if (
        data.kind !== "ok" ||
        typeof home !== "string" ||
        !(ALLOWED_HOME_PATHS as readonly string[]).includes(home) ||
        home !== homePathFor(audience)
      ) {
        setError("We could not open this account just now. Try again in a moment.");
        return;
      }
      // THE INVITATION IS SPENT. The code is cleared from THIS history
      // entry before the navigation.
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      // THE CODE AND THE PIN LEAVE THE PAGE'S MEMORY with the door.
      setToken(null);
      setPin("");
      setConfirm("");
      setRevealed(false);
      setPinBlurred(false);
      // A FULL DOCUMENT, HISTORY-REPLACING NAVIGATION. A soft router
      // navigation would leave the private home in the client router
      // cache, and a later Back would paint it again from that cache
      // after the session is gone. The full load drops that cache, and
      // the replaced entry leaves nothing for Back to restore.
      window.location.replace(home);
      leaving = true;
    } catch {
      setError(
        "We could not reach the club's server. Your invitation is still here — try again.",
      );
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) return;
    void submit();
  }

  if (!tokenReady) {
    return (
      <p className="text-[14px] leading-relaxed text-ink-2">
        Checking your invitation link…
      </p>
    );
  }

  // The missing-code panel is for a link with no usable code in it. It
  // is NOT shown while the form is on its way to the home, where the
  // code has been spent and cleared.
  if (token === null && !busy) {
    return (
      <div>
        <h1 className="font-display font-semibold text-ink">Open your account</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          This link is missing its invitation code. Open the link your club
          sent you, or ask them for a new one.
        </p>
        <Link
          href={audience === "member" ? "/member/sign-in" : "/family/sign-in"}
          className="mt-4 flex min-h-[44px] items-center justify-center text-[14px] text-ink-2 underline underline-offset-2"
        >
          Sign in with your PIN instead
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display font-semibold text-ink">Open your account</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Your club&apos;s invitation opens your{" "}
        {audience === "member" ? "membership" : "family view"}. Use the PIN for
        your existing account, or choose a first PIN now.
      </p>

      <form onSubmit={onSubmit} aria-busy={busy} className="space-y-5">
        <PinField
          id="invite-pin"
          value={pin}
          onChange={setPin}
          onBlur={() => setPinBlurred(true)}
          onKeyDown={submitOnEnter}
          revealed={revealed}
          onToggleRevealed={() => setRevealed((current) => !current)}
          invalid={pinError !== null}
          error={pinError ?? undefined}
        />
        <div>
          <Label htmlFor="invite-pin-confirm">Confirm PIN</Label>
          <p
            id="invite-pin-confirm-description"
            className="mt-1 text-[12px] text-ink-3"
          >
            Type the same PIN again.
          </p>
          <Input
            id="invite-pin-confirm"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={12}
            value={confirm}
            onChange={(event) =>
              setConfirm(event.target.value.replace(/\D/g, ""))
            }
            aria-describedby={
              confirmMismatch
                ? "invite-pin-confirm-description invite-pin-confirm-error"
                : "invite-pin-confirm-description"
            }
            aria-required="true"
            invalid={confirmMismatch}
            className="mt-1.5 min-h-[var(--control-height-lg)] text-[20px] font-display tracking-[0.3em]"
          />
          {confirmMismatch ? (
            <FieldError id="invite-pin-confirm-error">
              The two PINs do not match.
            </FieldError>
          ) : null}
        </div>
        {error ? (
          <p
            role="alert"
            data-testid="self-form-error"
            className="text-[13px] leading-relaxed text-ink-2"
          >
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          pill
          disabled={!canSubmit}
          className="w-full disabled:opacity-40"
        >
          {busy ? "One moment…" : "Open my account"}
        </Button>
      </form>
    </div>
  );
}
