"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { selectClubAction } from "@/lib/actions/club-selection";
import { syncBeforeLogout } from "@/lib/offline/logout";
import { clearOfflineData,runOfflineLifecycle } from "@/lib/offline/client-session";
import { Button } from "@/components/ui/Button";

type Choice = { tenantId: string; name: string; roleName: string };
export function ClubChoice({ choices,current }: { choices: Choice[]; current?: string }) {
  const router = useRouter();
  const [ready,setReady] = useState(false),[busy,setBusy] = useState(false);
  const [selected,setSelected] = useState(choices.find(choice => choice.tenantId === current)?.tenantId ?? ""),[drafts,setDrafts] = useState(0),[error,setError] = useState("");
  const choosing = useRef(false);
  const destination = choices.find(choice => choice.tenantId === selected);
  useEffect(() => { setReady(true); },[]);
  async function choose(discard = false) {
    if (!ready || choosing.current || !destination) return;
    choosing.current = true;
    setBusy(true);setError("");
    try {
      // Sync against the OLD club context before changing any cookie or cache.
      if (!discard) {
        const remaining = await syncBeforeLogout();
        if (remaining) { setDrafts(remaining);return; }
      }
      if (!await runOfflineLifecycle(() => clearOfflineData())) throw new Error("Offline storage could not be cleared");
      const result = await selectClubAction({ tenantId: selected });
      if ("error" in result) setError(result.error);
      else router.push(result.path);
    } catch {
      setError("Could not switch business accounts. Check your connection and try again.");
    } finally { choosing.current = false; setBusy(false); }
  }
  return <form onSubmit={event => { event.preventDefault();void choose(); }} aria-busy={busy} className="mt-6 space-y-4">
    <fieldset disabled={!ready || busy || drafts > 0} className="space-y-3">
      <legend className="mb-3 text-sm font-medium text-ink">Your available business accounts</legend>
      {choices.map(club => <label data-club-choice key={club.tenantId} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-ctl border border-line bg-paper p-4 has-checked:border-[var(--accent-strong)] has-checked:bg-[var(--accent-soft)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--focus-ring)]">
        <input type="radio" name="club" value={club.tenantId} checked={selected === club.tenantId} onChange={() => setSelected(club.tenantId)} className="h-5 w-5 shrink-0" />
        <span className="min-w-0 break-words text-base text-ink">{club.name}<span className="mt-1 block text-sm text-ink-2">{club.roleName}{club.tenantId === current ? " · Current account" : ""}</span></span>
      </label>)}
    </fieldset>
    {drafts > 0 ? <div role="alert" className="space-y-3 rounded-ctl border border-line bg-paper p-4">
      <p className="text-sm text-ink">{drafts} attendance {drafts === 1 ? "mark is" : "marks are"} waiting to sync. Stay in this account until they sync, or explicitly discard these local drafts.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void choose()}>Retry sync and switch</Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => void choose(true)}>Discard drafts and switch</Button>
        <Button type="button" disabled={busy} onClick={() => setDrafts(0)}>Stay in this account</Button>
      </div>
    </div> : null}
    {error ? <p role="alert" data-auth-feedback className="text-sm text-ink-2">{error}</p> : null}
    <p role="status" className="min-h-[1.4em] text-sm text-ink-2 [overflow-wrap:anywhere]">
      {destination ? <>{busy ? "Continuing to " : "Selected account · "}<strong>{destination.name}</strong>{busy ? "…" : ""}</> : "Select a business account to continue."}
    </p>
    <Button type="submit" variant="primary" disabled={!ready || busy || !destination || drafts > 0} className="w-full">{busy ? "Switching account…" : "Continue to account"}</Button>
    <noscript><p>Enable JavaScript to protect offline attendance before changing accounts.</p></noscript>
  </form>;
}
