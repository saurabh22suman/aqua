"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { RedeemRouteResult } from "@/app/api/login-link/redeem/route";

// Confirm screen for a staff magic-link login. The token arrived
// in the URL (hand-forwarded by the owner -- there is no delivery
// channel yet), so this page says plainly what accepting does:
// one session, single-use, bearer credential. Accepting POSTs to
// the redeem route, which sets the session cookie explicitly on
// its response; on success a full navigation carries the cookie
// to the role home.
export function LoginLinkRedeemForm({
  token,
  phone,
  roleKey,
  tenantName,
  expiresAt,
}: {
  token: string;
  phone: string;
  roleKey: string;
  tenantName: string;
  expiresAt: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAccept() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/login-link/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
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

  return (
    <main className="px-5 pt-10">
      <p className="text-[13px] text-ink-3">{tenantName}</p>
      <h1 className="font-display text-[19px] font-semibold">Sign in</h1>
      <p className="mt-2 text-[14px] text-ink-2">
        This link signs in <span className="font-mono">{phone}</span> as {roleKey}.
      </p>
      <p className="mt-1 text-[13px] text-ink-3">
        It works once and expires {expiresAt}. Anyone holding it can use it — don&apos;t forward it.
      </p>
      {error ? (
        <p className="mt-3 text-[13px] text-ink-2" role="alert">{error}</p>
      ) : null}
      <button
        type="button"
        onClick={onAccept}
        disabled={busy}
        className="mt-5 inline-flex items-center justify-center rounded-pill px-5 py-3 text-[14.5px] font-semibold text-paper bg-[var(--accent)] disabled:opacity-50"
        data-testid="login-link-accept"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : "Sign in"}
      </button>
    </main>
  );
}
