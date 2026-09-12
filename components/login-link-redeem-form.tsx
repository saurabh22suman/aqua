"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { RedeemRouteResult } from "@/app/api/login-link/redeem/route";
import type { InviteLinkPurpose } from "@/db/schema/invite-link-uses";

// Confirm screen for a staff magic-link login. The token arrived
// in the URL (hand-forwarded by the owner -- there is no delivery
// channel yet), so this page says plainly what accepting does:
// one session, single-use, bearer credential. Accepting POSTs to
// the redeem route, which sets the session cookie explicitly on
// its response; on success a full navigation carries the cookie
// to the role home.
//
// 2026-09-11 auth feature: two modes.
//   - set-PIN (credentialSet=false, or purpose="reset"): the
//     holder picks the 6-12 digit PIN they will use at /login.
//     A mismatch never reaches the network.
//   - confirm (a credential exists and this is not a reset):
//     today's screen. The request carries only the token; an
//     invite/relogin link may never overwrite a PIN.
export function LoginLinkRedeemForm({
  token,
  phone,
  roleKey,
  tenantName,
  expiresAt,
  credentialSet,
  purpose,
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
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const isReset = purpose === "reset";
  const setPinMode = !credentialSet || isReset;

  async function redeem(body: { token: string; pin?: string }) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/login-link/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await res.json().catch(() => null)) as RedeemRouteResult | null;
      if (!res.ok || !result || result.kind === "error") {
        setError(
          "This link didn't work — it may already have been used or expired. Ask your club for a fresh one.",
        );
        return;
      }
      window.location.href = result.homePath;
    } finally {
      setBusy(false);
    }
  }

  async function onSetPin() {
    if (!/^\d{6,12}$/.test(pin)) {
      setError("Choose a PIN of 6 to 12 digits.");
      return;
    }
    if (pin !== confirmPin) {
      setError("The PINs do not match.");
      return;
    }
    await redeem({ token, pin });
  }

  return (
    <main className="px-5 pt-10">
      <p className="text-[13px] text-ink-3">{tenantName}</p>
      <h1 className="font-display text-[19px] font-semibold">
        {isReset ? "Choose a new PIN" : setPinMode ? "Choose your PIN" : "Sign in"}
      </h1>
      {setPinMode ? (
        <>
          <p className="mt-2 text-[14px] text-ink-2">
            This link is for <span className="font-mono">{phone}</span>. Pick a 6–12 digit
            PIN — you will use your mobile number and this PIN to sign in from now on.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[14px] text-ink-2">
          This link signs in <span className="font-mono">{phone}</span> as {roleKey}.
        </p>
      )}
      <p className="mt-1 text-[13px] text-ink-3">
        It works once and expires {expiresAt}. Anyone holding it can use it — don&apos;t
        forward it.
      </p>

      {setPinMode ? (
        <>
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
        </>
      ) : null}

      {error ? (
        <p className="mt-3 text-[13px] text-ink-2" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => (setPinMode ? onSetPin() : redeem({ token }))}
        disabled={busy}
        className="mt-5 inline-flex items-center justify-center rounded-pill px-5 py-3 text-[14.5px] font-semibold text-paper bg-[var(--accent)] disabled:opacity-50"
        data-testid="login-link-accept"
      >
        {busy ? (
          <Loader2 size={15} className="animate-spin" />
        ) : setPinMode ? (
          "Set PIN"
        ) : (
          "Sign in"
        )}
      </button>
    </main>
  );
}
