"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { homeForSessionAction } from "@/lib/actions/auth-ui";

// Set-PIN safety net (2026-09-11 auth feature). Shown by
// app/(auth)/set-pin when a session exists but no credential does —
// the user redeemed a link but closed the set-PIN screen before
// submitting. The normal path sets the PIN during redemption.
export function SetPinForm() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!/^\d{6,12}$/.test(pin)) {
      setError("Choose a PIN of 6 to 12 digits.");
      return;
    }
    if (pin !== confirmPin) {
      setError("The PINs do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/account/set-pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.status === 409) {
        setError("A PIN is already set for this account. Sign in with it instead.");
        return;
      }
      if (!res.ok) {
        setError("Could not set the PIN. Sign in again and retry.");
        return;
      }
      const home = await homeForSessionAction();
      if (home.kind === "ok") {
        router.push(home.path);
        return;
      }
      if (home.kind === "suspended") {
        setError(`Your club (${home.tenantSlugs.join(", ")}) is paused.`);
        return;
      }
      setError("No club found for this number.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="mt-5 block">
        <span className="block text-[13px] font-medium text-ink-2">PIN</span>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={12}
          aria-label="PIN"
          placeholder="••••••"
          className="mt-1 w-full h-14 px-4 rounded-ctl bg-paper border border-line text-[20px] font-display tracking-[0.3em]"
        />
      </label>
      <label className="mt-4 block">
        <span className="block text-[13px] font-medium text-ink-2">Confirm PIN</span>
        <input
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={12}
          aria-label="Confirm PIN"
          placeholder="••••••"
          className="mt-1 w-full h-14 px-4 rounded-ctl bg-paper border border-line text-[20px] font-display tracking-[0.3em]"
        />
      </label>
      {error ? (
        <p className="mt-3 text-[13px] text-ink-2" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="mt-5 w-full h-14 rounded-pill text-white text-[15px] font-medium bg-[var(--accent)] disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save PIN"}
      </button>
    </div>
  );
}
