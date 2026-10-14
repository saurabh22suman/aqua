"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { homeForSessionAction } from "@/lib/actions/auth-ui";
import { formatPhoneIN, normaliseToE164 } from "@/lib/phone";
import { syncBeforeLogout } from "@/lib/offline/logout";
import { clearOfflineData, runOfflineLifecycle } from "@/lib/offline/client-session";

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
  const [drafts, setDrafts] = useState(0);

  // F-1 (2026-09-13 Indian-user UX audit): the same shared helper the
  // service uses, so what the client sends is exactly what the server
  // looks up. Typing a bare 10-digit mobile now works; the on-blur
  // format shows the user the canonical +91 form before they submit.
  function normalise(v: string) {
    return normaliseToE164(v);
  }

  function showCanonical() {
    setPhone((current) =>
      current.trim().length > 0 ? formatPhoneIN(normalise(current)) : current,
    );
  }

  const canSubmit = phone.length > 0 && /^\d{6,12}$/.test(pin) && !busy;

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

  return (
    <div className="px-5 pt-16 max-w-md mx-auto">
      <h1 className="font-display text-[22px] font-semibold text-marine">Sign in</h1>
      <p className="mt-2 text-[14px] text-ink-2">
        Use your mobile number and PIN. If you have never joined, ask your club for a login link.
      </p>

      <label className="mt-8 block">
        <span className="block text-[13px] font-medium text-ink-2">Mobile number</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={showCanonical}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
          inputMode="tel"
          autoComplete="tel"
          aria-label="Mobile number"
          placeholder="+91 98765 43210"
          className="mt-1 w-full h-12 px-4 rounded-ctl bg-paper border border-line text-[16px]"
        />
        {/* F-1 contributing cause: a first-time user could not tell
            whether the country code was required. It isn't — say so. */}
        <span className="mt-1 block text-[12px] text-ink-3">
          Any format works — 98765 43210 or +91 98765 43210. We add +91 for you.
        </span>
      </label>

      <label className="mt-4 block">
        <span className="block text-[13px] font-medium text-ink-2">PIN</span>
        <input
          value={pin}
          type="password"
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
        onClick={() => void submit()}
        disabled={!canSubmit}
        className="mt-6 w-full h-14 rounded-pill text-white text-[15px] font-medium bg-[var(--accent-strong)] transition-colors duration-150 disabled:opacity-40"
      >
        {busy ? "One moment…" : "Sign in"}
      </button>
      {drafts > 0 ? <div className="mt-4 space-y-3 rounded-ctl border border-line bg-paper p-4">
        <p role="alert" className="text-[14px] text-ink">{drafts} unsynced attendance marks remain on this device. Connect to sync them, or discard them before signing in.</p>
        <button type="button" disabled={busy} onClick={() => void submit(true)}
          className="min-h-11 rounded-ctl border border-line px-3 text-[14px] text-ink">Discard drafts and continue sign-in</button>
        <button type="button" disabled={busy} onClick={() => { setDrafts(0); setPin(""); }}
          className="ml-2 min-h-11 text-[14px] text-ink-2 underline">Cancel sign-in</button>
      </div> : null}
      <Link href="/login/reset" className="mt-3 flex min-h-[44px] items-center justify-center text-[14px] text-ink-2 underline">
        Forgot PIN? Reset with WhatsApp
      </Link>
    </div>
  );
}
