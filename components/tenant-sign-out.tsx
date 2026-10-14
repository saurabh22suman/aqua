"use client";

import { useEffect, useState } from "react";
import { logoutTenantAction } from "@/lib/actions/tenant-auth";
import { syncBeforeLogout } from "@/lib/offline/logout";
import { clearOfflineData, runOfflineLifecycle } from "@/lib/offline/client-session";
import { Button } from "@/components/ui/Button";

export function TenantSignOut({ className = "mt-6" }: { className?: string }) {
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState(0), [error, setError] = useState("");
  useEffect(() => { setReady(true); }, []);
  async function signOut(discard = false) {
    if (!ready || busy) return;
    setBusy(true); setError("");
    try {
      if (!discard) {
        const remaining = await syncBeforeLogout();
        if (remaining) { setDrafts(remaining); return; }
      }
      await runOfflineLifecycle(() => clearOfflineData());
      await logoutTenantAction();
    } catch {
      setError("Could not finish signing out. Retry when connected; local offline data must be cleared first.");
    } finally { setBusy(false); }
  }
  return <form action={logoutTenantAction} className={className}
    onSubmit={event => { event.preventDefault(); void signOut(); }} aria-busy={busy}>
    {drafts > 0 ? <div className="mb-3 space-y-3 rounded-ctl border border-line bg-paper p-4">
      <p role="alert" className="text-[14px] text-ink">{drafts} attendance {drafts === 1 ? "mark is" : "marks are"} saved on this device but not synced.</p>
      <p className="text-[13px] text-ink-2">Connect and retry syncing, or discard these local drafts before signing out. Recorded server attendance is kept.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void signOut()}>Retry sync and sign out</Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => void signOut(true)}>Discard drafts and sign out</Button>
        <Button type="button" disabled={busy} onClick={() => setDrafts(0)}>Stay signed in</Button>
      </div>
    </div> : null}
    {error ? <p role="alert" className="mb-3 text-[13px] text-ink-2">{error}</p> : null}
    <Button type="submit" size="md" disabled={!ready || busy} className="w-full justify-start">
      {busy ? "Syncing and signing out…" : "Sign out"}
    </Button>
    <noscript><p>Enable JavaScript to safely clear offline data before signing out.</p></noscript>
  </form>;
}
