"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { FacilityDraftGuard } from "@/components/settings/facility-draft-guard";
import { saveClubBillingDefaultAction } from "@/lib/actions/facility-billing";
import { GST_STATE_NAMES, GST_STATE_OPTIONS } from "@/lib/gst";
import type { ClubBillingDefault, saveClubBillingDefaultSchema } from "@/lib/services/facility-billing-contract";
import { useFacilityValidation } from "@/components/settings/use-facility-validation";

type Draft = { legalName: string; line1: string; line2: string; city: string; postalCode: string; stateCode: string; gstin: string };
function toDraft(value: ClubBillingDefault): Draft {
  return { legalName: value.legalName ?? "", line1: value.legalAddress?.line1 ?? "", line2: value.legalAddress?.line2 ?? "", city: value.legalAddress?.city ?? "", postalCode: value.legalAddress?.postalCode ?? "", stateCode: value.stateCode ?? "", gstin: value.gstin ?? "" };
}

export function FacilityClubBillingForm({ initial }: { initial: ClubBillingDefault }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const { checking, run } = useFacilityValidation(() => { setReviewOpen(false); setSuccess(false); setMessage("Could not load validation. Nothing was submitted; please try again."); });
  const locked = busy || checking;
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved));
  const mismatch = !!draft.gstin.trim() && !!draft.stateCode && draft.gstin.trim().slice(0, 2) !== draft.stateCode;
  const labels: Record<keyof Draft, string> = { legalName: "Billing legal name", line1: "Legal address line 1", line2: "Legal address line 2 (optional)", city: "City", postalCode: "PIN code", stateCode: "Billing state", gstin: "GSTIN (optional)" };
  const fieldProps = (name: keyof Draft) => ({ id: `club-billing-${name}`, "aria-label": labels[name], "aria-invalid": errors[name] ? true : undefined, "aria-describedby": errors[name] ? `club-billing-${name}-error` : undefined });
  const fieldError = (name: keyof Draft) => errors[name] ? <span id={`club-billing-${name}-error`} className="mt-1 block text-[12px] text-ink-2">{errors[name]}</span> : null;
  function change(name: keyof Draft, value: string) { setDraft((current) => ({ ...current, [name]: value })); }
  function validate(schema: typeof saveClubBillingDefaultSchema) {
    const hasAddress = Boolean(draft.line1 || draft.line2 || draft.city || draft.postalCode);
    const parsed = schema.safeParse({ legalName: draft.legalName.trim() || null, legalAddress: hasAddress ? { line1: draft.line1, line2: draft.line2.trim() || null, city: draft.city, postalCode: draft.postalCode } : null, stateCode: draft.stateCode || null, gstin: draft.gstin.trim() || null });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) { const key = String(issue.path.at(-1) ?? "form"); next[key] ??= issue.message; }
      setErrors(next); setSuccess(false); setMessage("Check the highlighted billing details.");
      const first = Object.keys(next)[0]; if (first) document.getElementById(`club-billing-${first}`)?.focus();
      return null;
    }
    if (mismatch) { setErrors({ gstin: "GSTIN and billing state do not match." }); setSuccess(false); setMessage("Review the GSTIN and billing state."); document.getElementById("club-billing-gstin")?.focus(); return null; }
    setErrors({}); return parsed.data;
  }
  async function save(schema: typeof saveClubBillingDefaultSchema) {
    const input = validate(schema); if (!input) return;
    setReviewOpen(false); setBusy(true); setSuccess(false); setMessage(null);
    try {
      const result = await saveClubBillingDefaultAction(input);
      if (!result.ok) { setMessage(result.message); return; }
      setSaved(result.value); setDraft(toDraft(result.value)); setSuccess(true); setMessage("Club billing default saved.");
    } catch { setUncertain(true); setMessage("Could not confirm whether the club default was saved. Reload and check before retrying."); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (reloading) window.location.reload(); }, [reloading]);
  useEffect(() => { if (!locked && Object.keys(errors)[0]) document.getElementById(`club-billing-${Object.keys(errors)[0]}`)?.focus(); }, [errors, locked]);
  return <section className="mt-5 max-w-3xl rounded-card border border-line bg-paper p-4 sm:p-5">
    <FacilityDraftGuard dirty={!reloading && (dirty || locked)} busy={locked} scope="club defaults" />
    <h2 className="font-display text-[16px] font-semibold">Club default · financial identity</h2>
    <p className="mt-1 text-[13px] text-ink-2">Sites set to inherit use this identity for new bills once enabled. Existing billing continues until you enable each site.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="block text-[13px] font-medium">Billing legal name<Input {...fieldProps("legalName")} value={draft.legalName} onChange={(e) => change("legalName", e.target.value)} disabled={locked || uncertain} />{fieldError("legalName")}</label>
      <label className="block text-[13px] font-medium">Legal address line 1<Input {...fieldProps("line1")} value={draft.line1} onChange={(e) => change("line1", e.target.value)} disabled={locked || uncertain} />{fieldError("line1")}</label>
      <label className="block text-[13px] font-medium">Legal address line 2 (optional)<Input {...fieldProps("line2")} value={draft.line2} onChange={(e) => change("line2", e.target.value)} disabled={locked || uncertain} />{fieldError("line2")}</label>
      <label className="block text-[13px] font-medium">City<Input {...fieldProps("city")} value={draft.city} onChange={(e) => change("city", e.target.value)} disabled={locked || uncertain} />{fieldError("city")}</label>
      <label className="block text-[13px] font-medium">PIN code<Input {...fieldProps("postalCode")} value={draft.postalCode} inputMode="numeric" onChange={(e) => change("postalCode", e.target.value)} disabled={locked || uncertain} />{fieldError("postalCode")}</label>
      <label className="block text-[13px] font-medium">Billing state<Select {...fieldProps("stateCode")} value={draft.stateCode} onChange={(e) => change("stateCode", e.target.value)} disabled={locked || uncertain}><option value="">Not set</option>{GST_STATE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</Select>{fieldError("stateCode")}</label>
      <label className="block text-[13px] font-medium">GSTIN (optional)<Input {...fieldProps("gstin")} value={draft.gstin} maxLength={15} onChange={(e) => change("gstin", e.target.value)} disabled={locked || uncertain} />{fieldError("gstin")}</label>
    </div>
    {mismatch ? <p role="alert" className="mt-3 text-[13px] text-ink-2">GSTIN and billing state do not match. Review both before saving.</p> : null}
    {checking ? <p role="status" className="mt-3 text-[13px] text-ink-2">Checking billing details…</p> : message ? <p role={success ? "status" : "alert"} className="mt-3 text-[13px] text-ink-2">{message}</p> : null}
    <div className="mt-5 flex flex-wrap gap-3">
      <Button type="button" disabled={locked || uncertain || !dirty || mismatch} onClick={() => void run(({ saveClubBillingDefaultSchema }) => { if (validate(saveClubBillingDefaultSchema)) setReviewOpen(true); })}>Review club default</Button>
      {dirty && !uncertain ? <Button type="button" variant="secondary" disabled={locked} onClick={() => setDiscardOpen(true)}>Discard changes</Button> : null}
      {uncertain ? <Button type="button" variant="secondary" onClick={() => setReloadOpen(true)}>Reload and check saved state</Button> : null}
    </div>
    <Dialog open={reviewOpen} onOpenChange={(open) => { if (!locked) setReviewOpen(open); }} title="Review club default" description={`Club-wide default: ${draft.legalName || "legal name not set"} · ${draft.gstin || "unregistered"} · ${draft.stateCode ? GST_STATE_NAMES[draft.stateCode] ?? draft.stateCode : "state not set"}. Enabled facilities that inherit may use this identity for new bills; their own overrides are unchanged. Past bills remain unchanged. Finish billing or void affected open café orders before changing the billing identity.`} footer={<><Button variant="secondary" disabled={locked} onClick={() => setReviewOpen(false)}>Cancel</Button><Button disabled={locked} onClick={() => void run(({ saveClubBillingDefaultSchema }) => save(saveClubBillingDefaultSchema))}>{checking ? <span role="status">Checking…</span> : "Save club default"}</Button></>} />
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen} title="Discard club-default changes?" description="The unsaved draft will be lost; saved billing details and past bills stay unchanged." footer={<><Button variant="secondary" onClick={() => setDiscardOpen(false)}>Keep editing</Button><Button onClick={() => { setDraft(toDraft(saved)); setErrors({}); setMessage(null); setDiscardOpen(false); }}>Discard changes</Button></>} />
    <Dialog open={reloadOpen} onOpenChange={setReloadOpen} title="Reload and check saved state?" description="The last result is unknown. Reload to see what was saved; the current unsaved draft will be lost." footer={<><Button variant="secondary" onClick={() => setReloadOpen(false)}>Keep draft</Button><Button onClick={() => { setReloadOpen(false); setReloading(true); }}>Reload and check</Button></>} />
  </section>;
}
