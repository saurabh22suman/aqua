"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { homeForSessionAction } from "@/lib/actions/auth-ui";

// 2026-09-11 auth feature: phone + PIN login.
//
// The first login is always a magic link, which shows the set-PIN
// screen. From then on this form is the door: the mobile number plus
// the 6-12 digit PIN. The OTP endpoints still exist in the codebase
// (better-auth phone plugin) and will light up unchanged once an SMS
// channel lands; they are deliberately not surfaced here because
// nothing is delivered.
//
// Errors are deliberately coarse: one message for "wrong number or
// PIN" (the API is a generic 401 for wrong PIN, unknown number and
// locked account alike), one for a paused club, one for "no club on
// this number". Nothing here is an oracle for which case fired.
export function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function normalise(v: string) {
    return v.replace(/[\s-]/g, "");
  }

  const canSubmit = phone.length > 0 && /^\d{6,12}$/.test(pin) && !busy;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 pt-16 max-w-md mx-auto">
      <h1 className="font-display text-[22px] font-semibold text-marine">Sign in</h1>
      <p className="mt-2 text-[14px] text-ink-2">
        Use your mobile number and the PIN you set when you joined. No code arrives by
        SMS — if you have never set a PIN, ask your club for a login link.
      </p>

      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
        inputMode="tel"
        autoComplete="tel"
        placeholder="+91 98765 43210"
        className="mt-8 w-full h-12 px-4 rounded-ctl bg-paper border border-line text-[16px]"
      />

      <label className="mt-4 block">
        <span className="block text-[13px] font-medium text-ink-2">PIN</span>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={12}
          aria-label="PIN"
          placeholder="••••••"
          className="mt-1 w-full h-14 px-4 rounded-ctl bg-paper border border-line text-[20px] font-display tracking-[0.3em]"
        />
      </label>

      {error ? (
        <p className="mt-4 text-[13px] text-ink-3" role="alert">
          {error}
        </p>
      ) : null}

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="mt-6 w-full h-14 rounded-pill text-white text-[15px] font-medium bg-[var(--accent)] transition-colors duration-150 disabled:opacity-40"
      >
        {busy ? "One moment…" : "Sign in"}
      </button>
    </div>
  );
}
