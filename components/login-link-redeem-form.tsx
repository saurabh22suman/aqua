"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { LoginWelcome } from "@/components/auth/login-welcome";
import { ConfirmPinField } from "@/components/auth/confirm-pin-field";
import { PinField } from "@/components/auth/pin-field";
import { Button } from "@/components/ui/Button";
import type { RedeemRouteResult } from "@/app/api/login-link/redeem/route";
import type { InviteLinkPurpose } from "@/db/schema/invite-link-uses";
import { formatPhoneIN } from "@/lib/phone";

export function LoginLinkRedeemForm({
  token, phone, roleKey, tenantName, expiresAt, credentialSet, purpose,
}: {
  token: string;
  phone: string;
  roleKey: string;
  tenantName: string;
  expiresAt: string;
  credentialSet: boolean;
  purpose: InviteLinkPurpose;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinRevealed, setPinRevealed] = useState(false);
  const [fieldError, setFieldError] = useState<"pin" | "confirm" | null>(null);
  const submitting = useRef(false);

  const isReset = purpose === "reset";
  const setPinMode = !credentialSet || isReset;

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || uncertain) return;
    setError(null);
    if (setPinMode && (!/^\d{6,12}$/.test(pin) || pin !== confirmPin)) {
      const target = !/^\d{6,12}$/.test(pin) ? "pin" : "confirm";
      setFieldError(target);
      document.getElementById("staff-invitation-" + target)?.focus();
      return;
    }
    setFieldError(null);
    submitting.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/login-link/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(setPinMode ? { token, pin } : { token }),
      });
      const result = (await res.json().catch(() => null)) as RedeemRouteResult | null;
      if (res.status >= 500 || !result) throw new Error("Link outcome unavailable");
      if (!res.ok || result.kind === "error") {
        setError("This link didn't work. It may have been used or expired. Ask your club for a fresh one.");
        return;
      }
      setPin("");
      setConfirmPin("");
      setPinRevealed(false);
      window.location.href = result.homePath;
    } catch {
      setError("Could not confirm whether the link was used. Check by signing in, or ask your club for a fresh link.");
      setUncertain(true);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <LoginWelcome>
      <p className="text-[13px] font-medium text-ink-2 [overflow-wrap:anywhere]">{tenantName}</p>
      <h1 className="font-display text-[19px] font-semibold">
        {isReset ? "Choose a new PIN" : setPinMode ? "Choose your PIN" : "Sign in"}
      </h1>
      <div className="mt-3 rounded-ctl border border-line bg-deck p-3">
        <p className="text-sm text-ink-2">
          {setPinMode ? "This link is for " : "This link signs in "}
          <span className="font-mono">{formatPhoneIN(phone)}</span>{!setPinMode ? ` as ${roleKey}` : ""}.
        </p>
        <p className="mt-1 text-[13px] text-ink-2">Single use. Expires {expiresAt}. Keep this link private.</p>
      </div>
      <form onSubmit={redeem} aria-busy={busy} className="mt-4 space-y-4">
        <fieldset className="min-w-0 space-y-4" disabled={busy || uncertain}>
          {setPinMode ? (
            <>
              <PinField id="staff-invitation-pin" value={pin} revealed={pinRevealed} autoComplete="new-password"
                onChange={(value) => { setPin(value); setFieldError(null); }}
                onToggleRevealed={() => setPinRevealed(!pinRevealed)}
                invalid={fieldError === "pin"} error="Choose a PIN of 6 to 12 digits." />
              <ConfirmPinField id="staff-invitation-confirm" value={confirmPin}
                onChange={(value) => { setConfirmPin(value); setFieldError(null); }}
                error={fieldError === "confirm" ? "The PINs do not match." : undefined} />
            </>
          ) : null}
          {uncertain ? null : (
            <Button type="submit" variant="primary" size="lg" className="w-full" data-testid="login-link-accept">
              {busy ? "Opening link…" : setPinMode ? "Set PIN" : "Sign in"}
            </Button>
          )}
        </fieldset>
        {error ? (
          <div className="rounded-ctl border border-line bg-deck px-3 py-2">
            <p className="text-sm text-ink-2" role="alert" data-auth-feedback>{error}</p>
            <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-2">
              {uncertain ? "Check by signing in" : "Back to sign in"}
            </Link>
          </div>
        ) : null}
      </form>
    </LoginWelcome>
  );
}
