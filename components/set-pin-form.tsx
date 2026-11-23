"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { homeForSessionAction } from "@/lib/actions/auth-ui";
import { ConfirmPinField } from "@/components/auth/confirm-pin-field";
import { PinField } from "@/components/auth/pin-field";
import { Button } from "@/components/ui/Button";

export function SetPinForm() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [fieldError, setFieldError] = useState<"pin" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkSignIn, setCheckSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    setCheckSignIn(false);
    if (!/^\d{6,12}$/.test(pin) || pin !== confirm) {
      const target = !/^\d{6,12}$/.test(pin) ? "pin" : "confirm";
      setFieldError(target);
      document.getElementById("setup-" + target)?.focus();
      return;
    }
    setFieldError(null);
    submitting.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/account/set-pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.status === 409) {
        setError("A PIN is already set for this account.");
        setCheckSignIn(true);
        return;
      }
      if (res.status >= 500) throw new Error("PIN outcome unavailable");
      if (!res.ok) {
        setError("Could not set the PIN. Sign in again and retry.");
        setCheckSignIn(true);
        return;
      }
      const home = await homeForSessionAction();
      if (home.kind === "ok") {
        setPin("");
        setConfirm("");
        setRevealed(false);
        router.push(home.path);
        return;
      }
      setError(home.kind === "suspended" ? `Your club (${home.tenantSlugs.join(", ")}) is paused.` : "No club found for this number.");
    } catch {
      setError("Could not confirm whether your PIN was saved. Try signing in with it to check.");
      setCheckSignIn(true);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-busy={busy} className="mt-5">
      <fieldset className="min-w-0 space-y-4" disabled={busy}>
        <PinField id="setup-pin" value={pin} revealed={revealed} autoComplete="new-password"
          onChange={(value) => { setPin(value); setFieldError(null); }}
          onToggleRevealed={() => setRevealed(!revealed)}
          invalid={fieldError === "pin"} error="Choose a PIN of 6 to 12 digits." />
        <ConfirmPinField id="setup-confirm" value={confirm}
          onChange={(value) => { setConfirm(value); setFieldError(null); }}
          error={fieldError === "confirm" ? "The PINs do not match." : undefined} />
        {error ? (
          <div className="rounded-ctl border border-line bg-deck p-3 text-sm text-ink-2">
            <p role="alert" data-auth-feedback>{error}</p>
            {checkSignIn ? <Link href="/login" className="inline-flex min-h-11 items-center font-medium underline underline-offset-2">Check by signing in</Link> : null}
          </div>
        ) : null}
        <Button type="submit" variant="primary" size="lg" className="w-full">{busy ? "Saving…" : "Save PIN"}</Button>
      </fieldset>
    </form>
  );
}
