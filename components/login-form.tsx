"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { homeForSessionAction, devCodeAction } from "@/lib/actions/auth-ui";

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [devHint, setDevHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function normalise(v: string) {
    return v.replace(/[\s-]/g, "");
  }

  async function submitPhone() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/phone-number/send-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber: normalise(phone) }),
      });
      if (!res.ok) {
        setError("Could not send the code. Check the number and try again.");
        return;
      }
      setStep("code");
      if (process.env.NODE_ENV !== "production") {
        setDevHint((await devCodeAction(normalise(phone))) ?? "");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/phone-number/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber: normalise(phone), code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        if (/too many attempts/i.test(body?.message ?? "")) {
          setError("Too many attempts. Request a new code.");
        } else {
          setError("That code did not match or has expired.");
        }
        return;
      }
      const home = await homeForSessionAction();
      if (!home) {
        setError("No membership found for this number.");
        return;
      }
      router.push(home);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 pt-16 max-w-md mx-auto">
      <h1 className="font-display text-[22px] font-semibold text-marine">
        {step === "phone" ? "Sign in" : "Enter the code"}
      </h1>
      <p className="mt-2 text-[14px] text-ink-2">
        {step === "phone"
          ? "We'll text you a six-digit code."
          : `Sent to ${phone}. It expires in five minutes.`}
      </p>

      {step === "phone" ? (
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && phone && submitPhone()}
          inputMode="tel"
          autoComplete="tel"
          placeholder="+91 98765 43210"
          className="mt-8 w-full h-12 px-4 rounded-ctl bg-paper border border-line text-[16px]"
        />
      ) : (
        <>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && code.length === 6 && submitCode()}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            className="mt-8 w-full h-14 px-4 rounded-ctl bg-paper border border-line text-[22px] font-display tracking-[0.4em] text-center"
          />
          {devHint ? (
            <p className="mt-3 text-[12px] text-ink-3">
              dev code: <span data-testid="dev-code" className="font-medium text-ink-2">{devHint}</span>
            </p>
          ) : null}
        </>
      )}

      {error ? <p className="mt-4 text-[13px] text-late">{error}</p> : null}

      <button
        onClick={() => (step === "phone" ? submitPhone() : submitCode())}
        disabled={busy || (step === "phone" ? !phone : code.length !== 6)}
        className="mt-6 w-full h-14 rounded-pill text-white text-[15px] font-medium bg-[var(--accent)] transition-colors duration-150 disabled:opacity-40"
      >
        {busy ? "One moment…" : step === "phone" ? "Send code" : "Verify and continue"}
      </button>

      {step === "code" ? (
        <button
          onClick={() => setStep("phone")}
          className="mt-5 text-[13px] text-ink-3 underline underline-offset-2"
        >
          Use a different number
        </button>
      ) : null}
    </div>
  );
}
