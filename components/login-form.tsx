"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { homeForSessionAction } from "@/lib/actions/auth-ui";
import { formatPhoneIN, normaliseToE164 } from "@/lib/phone";
import { syncBeforeLogout } from "@/lib/offline/logout";
import { clearOfflineData, runOfflineLifecycle } from "@/lib/offline/client-session";
import { PhoneField } from "@/components/auth/phone-field";
import { PinField } from "@/components/auth/pin-field";
import { Button } from "@/components/ui/Button";

// Phone + PIN login.
//
// The first login is a magic link that shows the set-PIN screen; from
// then on this form is the door. The OTP endpoints exist but are not
// surfaced — nothing is delivered.
//
// Errors are deliberately coarse: one message for "wrong number or PIN"
// (the API returns a generic 401 for a wrong PIN, an unknown number and
// a locked account alike), one for a paused club, one for "no club on
// this number". Nothing here is an oracle for which case fired.
//
// The 2026-10-26 restyle changed the presentation, not the
// authentication: the same normalisation helper, the same 6–12 digit
// rule, the same POST /api/login/pin, the same role routing, the same
// WhatsApp recovery route, and unsynced attendance drafts still hold
// the sign-in until the person chooses to sync or discard them.

const PIN_RULE = /^\d{6,12}$/;

export function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pinRevealed, setPinRevealed] = useState(false);
  const [pinBlurred, setPinBlurred] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState(0);

  // The same shared helper the service uses, so what the client sends
  // is exactly what the server looks up (F-1, Indian-user UX audit). A
  // bare 10-digit mobile works; the on-blur format shows the canonical
  // +91 form before the person submits.
  function normalise(v: string) {
    return normaliseToE164(v);
  }

  function showCanonical() {
    setPhone((current) =>
      current.trim().length > 0 ? formatPhoneIN(normalise(current)) : current,
    );
  }

  const pinValid = PIN_RULE.test(pin);
  // The rule is only complained about once the field has been left —
  // telling somebody their PIN is wrong while they are still typing the
  // first digit is noise.
  const pinError =
    pinBlurred && pin.length > 0 && !pinValid
      ? "Your PIN needs 6 to 12 digits."
      : null;

  // Unsynced drafts hold the sign-in, so the primary action stays
  // closed until the person has dealt with them.
  const canSubmit = phone.length > 0 && pinValid && !busy && drafts === 0;

  async function submit(discard = false) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (typeof indexedDB !== "undefined" && "serviceWorker" in navigator) {
        if (discard) await runOfflineLifecycle(() => clearOfflineData());
        else {
          const remaining = await syncBeforeLogout();
          if (remaining) { setDrafts(remaining); return; }
        }
      }
      const res = await fetch("/api/login/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: normalise(phone), pin }),
      });
      if (!res.ok) {
        setError("Wrong number or PIN. Try again, or ask your club for a login link.");
        return;
      }
      const home = await homeForSessionAction();
      if (home.kind === "ok") {
        router.push(home.path);
        return;
      }
      if (home.kind === "suspended") {
        // Phase 1.6 — the operator paused or churned this tenant.
        const list = home.tenantSlugs.join(", ");
        setError(
          `Your club (${list}) is paused. Reach out to your operator to reactivate it.`,
        );
        return;
      }
      setError("No club found for this number.");
    } catch {
      setError("Could not sign in. Retry when connected; pending offline drafts must be synced or explicitly discarded before switching accounts.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    void submit();
  }

  // Enter in a credential field goes through the form's own submit event.
  //
  // The handler sits on the two fields, never on the form: a form-wide
  // keydown handler also sees Enter aimed at the PIN reveal control and
  // swallows the button's own activation. Preventing the key's default
  // action keeps the browser's implicit submission from firing a second
  // request, so the form's submit handler stays the only place that
  // decides whether a request goes out. An IME composition is not a
  // submission and is left alone.
  function onEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing) return;
    const form = event.currentTarget.form;
    if (!form) return;
    event.preventDefault();
    form.requestSubmit();
  }

  return (
    <div className="relative">
      <h1 className="font-display text-[26px] font-semibold leading-tight text-ink">
        Sign in
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Welcome back. Your club is ready when you are.
      </p>

      <form onSubmit={onSubmit} aria-busy={busy} className="mt-7 space-y-5">
        <PhoneField
          id="login-phone"
          value={phone}
          onChange={setPhone}
          onBlur={showCanonical}
          onKeyDown={onEnter}
        />

        <PinField
          id="login-pin"
          value={pin}
          onChange={setPin}
          onBlur={() => setPinBlurred(true)}
          onKeyDown={onEnter}
          revealed={pinRevealed}
          onToggleRevealed={() => setPinRevealed((current) => !current)}
          invalid={pinError !== null}
          error={pinError ?? undefined}
        />

        {error ? (
          <p role="alert" className="text-[13px] leading-relaxed text-ink-2">
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
          {busy ? "One moment…" : "Sign in"}
        </Button>
      </form>

      {drafts > 0 ? (
        <div className="mt-5 space-y-3 rounded-ctl border border-line bg-paper p-4">
          <p role="alert" className="text-[14px] leading-relaxed text-ink">
            {drafts} unsynced attendance marks remain on this device. Connect
            to sync them, or discard them before signing in.
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void submit(true)}
            className="w-full"
          >
            Discard drafts and continue sign-in
          </Button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setDrafts(0); setPin(""); }}
            className="min-h-11 w-full text-[14px] text-ink-2 underline"
          >
            Cancel sign-in
          </button>
        </div>
      ) : null}

      <Link
        href="/login/reset"
        className="mt-4 flex min-h-[44px] items-center justify-center text-[14px] text-ink-2 underline underline-offset-2"
      >
        Forgot PIN? Reset with WhatsApp
      </Link>
    </div>
  );
}
