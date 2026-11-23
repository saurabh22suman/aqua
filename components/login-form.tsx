"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { homeForSessionAction } from "@/lib/actions/auth-ui";
import { formatPhoneIN, normaliseToE164 } from "@/lib/phone";
import { syncBeforeLogout } from "@/lib/offline/logout";
import { clearOfflineData, localOfflineScope, runOfflineLifecycle } from "@/lib/offline/client-session";
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
  const [drafts, setDrafts] = useState<{
    count: number;
    scope: string | null;
    pinAccepted: boolean;
  } | null>(null);
  const [workspacePending, setWorkspacePending] = useState(false);

  // The same shared helper the service uses, so what the client sends
  // is exactly what the server looks up (F-1, Indian-user UX audit). A
  // bare 10-digit mobile works; the on-blur format shows the canonical
  // +91 form before the person submits.
  function normalise(v: string) {
    return normaliseToE164(v);
  }

  function showCanonical() {
    setPhone((current) => {
      const canonical = normalise(current);
      return /^\+?[\d\s()-]+$/.test(current) && /^\+[1-9]\d{7,14}$/.test(canonical)
        ? formatPhoneIN(canonical) : current;
    });
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
  const canUseCredentials = phone.length > 0 && pinValid;
  const canSubmit = !busy && !drafts && (workspacePending || canUseCredentials);

  function editCredentials(update: (value: string) => void, value: string) {
    if (busy || drafts?.pinAccepted) return;
    if (workspacePending) setWorkspacePending(false);
    if (error) setError(null);
    update(value);
  }

  async function openWorkspace() {
    try {
      const intent = new URLSearchParams(window.location.search);
      const home = intent.has("clubId") || intent.has("role")
        ? await homeForSessionAction({ clubId: intent.get("clubId"), role: intent.get("role") })
        : await homeForSessionAction();
      setWorkspacePending(false);
      if (home.kind === "ok") {
        router.push(home.path);
      } else if (home.kind === "suspended") {
        const list = home.tenantSlugs.join(", ");
        setError(`Your club (${list}) is paused. Reach out to your operator to reactivate it.`);
      } else {
        setError("No club found for this number.");
      }
    } catch {
      setWorkspacePending(true);
      setPin("");
      setPinRevealed(false);
      setError("Your PIN was accepted. Check your connection, then open your workspace.");
    }
  }

  async function submit(discard = false) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (workspacePending) {
        await openWorkspace();
        return;
      }
      if (!drafts?.pinAccepted) {
        if (!discard && typeof indexedDB !== "undefined" && "serviceWorker" in navigator) {
          const pending = await runOfflineLifecycle(async () => {
            const scope = await localOfflineScope();
            const count = await syncBeforeLogout();
            return count > 0 ? { count, scope, pinAccepted: false } : null;
          });
          setDrafts(pending);
          if (pending) return;
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
      }
      if (discard && drafts) {
        setDrafts({ ...drafts, pinAccepted: true });
        setPin("");
        setPinRevealed(false);
        try {
          const cleared = await runOfflineLifecycle(async () => {
            // Replacing the offline identity drops the old queue. Leave
            // the replacement alone if another tab has switched scopes.
            if (await localOfflineScope() !== drafts.scope) return true;
            return clearOfflineData(drafts.scope);
          });
          if (!cleared) throw new Error("Could not discard attendance drafts.");
        } catch {
          setError("Your PIN was accepted. Try discarding the drafts again to open your workspace.");
          return;
        }
        setDrafts(null);
      }
      await openWorkspace();
    } catch {
      setError("Could not reach the club. Check your connection, then try again.");
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
        Use your mobile number and PIN to open your staff workspace.
      </p>

      <form onSubmit={onSubmit} aria-busy={busy} className="mt-5 space-y-4">
        <PhoneField
          id="login-phone"
          value={phone}
          onChange={(value) => editCredentials(setPhone, value)}
          onBlur={showCanonical}
          onKeyDown={onEnter}
        />

        <PinField
          id="login-pin"
          value={pin}
          onChange={(value) => editCredentials(setPin, value)}
          onBlur={() => setPinBlurred(true)}
          onKeyDown={onEnter}
          revealed={pinRevealed}
          onToggleRevealed={() => setPinRevealed((current) => !current)}
          invalid={pinError !== null}
          error={pinError ?? undefined}
        />

        {error ? (
          <p role="alert" data-auth-feedback className="rounded-ctl border border-line bg-paper px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={!canSubmit}
          className="w-full disabled:opacity-60"
        >
          {busy ? (workspacePending ? "Opening workspace…" : "Signing in…") : workspacePending ? "Open workspace" : "Sign in"}
        </Button>
      </form>

      {drafts ? (
        <div className="mt-5 space-y-3 rounded-ctl border border-line bg-paper p-4">
          <p role="alert" className="text-[14px] leading-relaxed text-ink">
            {drafts.pinAccepted
              ? "Discard the old attendance drafts to finish signing in."
              : `${drafts.count} unsynced attendance marks remain on this device. Connect to sync them, or discard them after your PIN is accepted.`}
          </p>
          {drafts.pinAccepted ? (
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void submit(true)}
              className="w-full"
            >
              {busy ? "Discarding drafts…" : "Retry discarding drafts"}
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || !canUseCredentials}
                onClick={() => void submit()}
                className="w-full"
              >
                Sync drafts and continue
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !canUseCredentials}
                onClick={() => void submit(true)}
                className="w-full"
              >
                Discard drafts and continue sign-in
              </Button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setDrafts(null); setPin(""); }}
                className="min-h-11 w-full text-[14px] text-ink-2 underline"
              >
                Cancel sign-in
              </button>
            </>
          )}
        </div>
      ) : null}

      <Link
        href="/login/reset"
        aria-label="Forgot PIN? Reset with WhatsApp"
        className="mt-4 flex min-h-[44px] items-center justify-center text-[14px] text-ink-2 underline underline-offset-2"
      >
        Forgot PIN?
      </Link>
    </div>
  );
}
