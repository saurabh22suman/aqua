"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";
import { withdrawGuardianAuthorizationAction } from "@/lib/actions/guardian-authorization";

export function GuardianAuthorizationControl({ guardianshipId, personName, relationship }: { guardianshipId: string; personName: string; relationship: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  useEffect(() => { setReason(""); setConfirmed(false); setError(null); }, [guardianshipId]);

  async function submit() {
    if (pending.current || !confirmed || !reason.trim()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await withdrawGuardianAuthorizationAction({ guardianshipId, reason: reason.trim(), confirmed });
      if (result.kind === "error") { setError(result.message); return; }
      setReason("");
      setConfirmed(false);
      router.refresh();
    } catch {
      setError("The response did not arrive. Refresh to check whether the authorization ended.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-ctl border border-line bg-deck p-3">
      <p className="text-sm font-medium text-ink">{personName} · {relationship}</p>
      <p className="mt-1 text-sm text-ink-3">Ending this authorization removes access for this member and ends the guardian relationship used for notifications and consent.</p>
      <Label className="mt-2" htmlFor={`guardian-reason-${guardianshipId}`} required>Reason</Label>
      <Textarea
        id={`guardian-reason-${guardianshipId}`}
        className="mt-1"
        maxLength={500}
        required
        disabled={busy}
        value={reason}
        onChange={(event) => { setReason(event.target.value); setConfirmed(false); }}
      />
      <div className="mt-2">
        <Checkbox checked={confirmed} disabled={busy} onCheckedChange={setConfirmed}>
          I confirm that this guardian authorization should end.
        </Checkbox>
      </div>
      <Button className="mt-2" variant="secondary" size="sm" disabled={busy || !confirmed || !reason.trim()} onClick={() => void submit()}>
        {busy ? "Ending…" : "End guardian authorization"}
      </Button>
      {error ? <p role="alert" className="mt-2 text-sm text-ink-2">{error}</p> : null}
    </div>
  );
}
