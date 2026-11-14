"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Dialog } from "@/components/ui/Dialog";
import { FacilityDraftGuard } from "@/components/settings/facility-draft-guard";
import { GST_STATE_NAMES, GST_STATE_OPTIONS } from "@/lib/gst";
import { createBillingRegistrationAction, resetSiteBillingSettingAction, saveSiteBillingSettingAction } from "@/lib/actions/facility-billing";
import type { BillingAddress, ClubBillingDefault, SiteBillingChoice, SiteBillingSetting, createBillingRegistrationSchema, saveSiteBillingSettingSchema } from "@/lib/services/facility-billing-contract";
import { useFacilityValidation } from "@/components/settings/use-facility-validation";

type Mode = SiteBillingChoice["mode"];
const blankAddress: BillingAddress = { line1: "", line2: null, city: "", postalCode: "" };

export function FacilityBillingForm({ initial, club }: { initial: SiteBillingSetting; club: ClubBillingDefault }) {
  const [saved, setSaved] = useState(initial);
  const [stateCode, setStateCode] = useState(initial.stateCode ?? "");
  const [mode, setMode] = useState<Mode>(initial.choice.mode);
  const [registrationId, setRegistrationId] = useState(initial.choice.mode === "registered_override" ? initial.choice.registrationId : "");
  const [legalName, setLegalName] = useState(initial.choice.mode === "unregistered_override" ? initial.choice.legalName : "");
  const [address, setAddress] = useState<BillingAddress>(initial.choice.mode === "unregistered_override" ? initial.choice.legalAddress : blankAddress);
  const [newGstin, setNewGstin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [enableOpen, setEnableOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { checking, run, runDirect } = useFacilityValidation(() => { setEnableOpen(false); setSuccess(false); setMessage("Could not load validation. Nothing was submitted; please try again."); });
  const locked = busy || checking;
  const choice: SiteBillingChoice = mode === "inherit" ? { mode } : mode === "registered_override" ? { mode, registrationId } : { mode, legalName, legalAddress: address };
  const registrationDraft = mode === "registered_override" && !registrationId && (Boolean(legalName || newGstin) || JSON.stringify(address) !== JSON.stringify(blankAddress));
  const dirty = stateCode !== (saved.stateCode ?? "") || JSON.stringify(choice) !== JSON.stringify(saved.choice) || registrationDraft;
  const selected = mode === "inherit" ? club : mode === "registered_override" ? saved.registrations.find((entry) => entry.id === registrationId)?.issuer : null;
  const mismatch = !!stateCode && !!selected?.stateCode && stateCode !== selected.stateCode;
  const resetMismatch = !!stateCode && !!club.stateCode && stateCode !== club.stateCode;
  const updateAddress = (key: keyof BillingAddress, value: string) => setAddress((current) => ({ ...current, [key]: key === "line2" && !value.trim() ? null : value }));
  const selectedName = mode === "unregistered_override" ? legalName || "Not entered" : selected?.legalName ?? "Not configured";
  const selectedGstin = mode === "unregistered_override" ? "Unregistered" : selected?.gstin ?? (selected ? "Unregistered" : "Not configured");
  const selectedState = mode === "unregistered_override" ? stateCode : selected?.stateCode;
  const selectedSource = mode === "inherit" ? "Club default" : mode === "registered_override" ? "Facility registration" : "Facility unregistered";
  const labels: Record<string, string> = { stateCode: "Facility billing state", mode: "Inherit club default", registrationId: "Facility registration", legalName: "Billing legal name", line1: "Legal address line 1", line2: "Legal address line 2 (optional)", city: "City", postalCode: "PIN code", gstin: "GSTIN" };
  const fieldProps = (name: string) => ({ id: `facility-${name}`, "aria-label": labels[name], "aria-invalid": errors[name] ? true : undefined, "aria-describedby": errors[name] ? `facility-${name}-error` : undefined });
  const fieldError = (name: string) => errors[name] ? <span id={`facility-${name}-error`} className="mt-1 block text-[12px] text-ink-2">{errors[name]}</span> : null;
  function showIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) {
    const next: Record<string, string> = {};
    for (const issue of issues) {
      const part = String(issue.path.at(-1) ?? "form");
      const name = part === "registrationId" ? "registrationId" : part === "mode" || part === "choice" ? "mode" : part;
      next[name] ??= issue.message;
    }
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) document.getElementById(`facility-${first}`)?.focus();
    setSuccess(false); setMessage("Check the highlighted billing details.");
  }
  function discardDraft() {
    setStateCode(saved.stateCode ?? ""); setMode(saved.choice.mode);
    setRegistrationId(saved.choice.mode === "registered_override" ? saved.choice.registrationId : "");
    setLegalName(saved.choice.mode === "unregistered_override" ? saved.choice.legalName : "");
    setAddress(saved.choice.mode === "unregistered_override" ? saved.choice.legalAddress : blankAddress);
    setNewGstin(""); setErrors({}); setMessage(null); setDiscardOpen(false);
  }
  useEffect(() => { if (reloading) window.location.reload(); }, [reloading]);
  useEffect(() => { if (!locked && Object.keys(errors)[0]) document.getElementById(`facility-${Object.keys(errors)[0]}`)?.focus(); }, [errors, locked]);

  async function save(enable: boolean, schema: typeof saveSiteBillingSettingSchema) {
    const parsed = schema.safeParse({ locationId: saved.locationId, stateCode, choice, enable });
    if (!parsed.success) { showIssues(parsed.error.issues); return; }
    setErrors({}); setSuccess(false); setBusy(true); setMessage(null);
    try {
      const result = await saveSiteBillingSettingAction(parsed.data);
      if (!result.ok) { setMessage(result.message); return; }
      setSaved(result.value);
      setStateCode(result.value.stateCode ?? "");
      setMode(result.value.choice.mode);
      setRegistrationId(result.value.choice.mode === "registered_override" ? result.value.choice.registrationId : "");
      setLegalName(result.value.choice.mode === "unregistered_override" ? result.value.choice.legalName : "");
      setAddress(result.value.choice.mode === "unregistered_override" ? result.value.choice.legalAddress : blankAddress);
      setNewGstin("");
      setSuccess(true);
      setMessage(enable && !saved.enabled ? "Facility billing enabled." : "Facility settings saved.");
    } catch { setUncertain(true); setMessage("Could not confirm whether the changes were saved. Reload and check this facility before retrying."); }
    finally { setBusy(false); }
  }

  async function reset() {
    setResetOpen(false); setSuccess(false); setBusy(true); setMessage(null);
    try {
      const result = await resetSiteBillingSettingAction({ locationId: saved.locationId });
      if (!result.ok) { setMessage(result.message); return; }
      setSaved(result.value); setStateCode(result.value.stateCode ?? ""); setMode(result.value.choice.mode); setRegistrationId(""); setLegalName(""); setAddress(blankAddress); setNewGstin("");
      setErrors({}); setSuccess(true);
      setMessage("Facility now uses the club default.");
    } catch { setUncertain(true); setMessage("Could not confirm whether the reset was saved. Reload and check this facility before retrying."); }
    finally { setBusy(false); }
  }

  async function createRegistration(schema: typeof createBillingRegistrationSchema) {
    const parsed = schema.safeParse({ legalName, legalAddress: address, stateCode, gstin: newGstin });
    if (!parsed.success) { showIssues(parsed.error.issues); return; }
    setErrors({}); setSuccess(false); setBusy(true); setMessage(null);
    try {
      const result = await createBillingRegistrationAction(parsed.data);
      if (!result.ok) { setMessage(result.message); return; }
      setSaved((current) => ({ ...current, registrations: [...current.registrations, result.value] }));
      setRegistrationId(result.value.id); setNewGstin("");
      setSuccess(true);
      setMessage("Registration created and selected in this unsaved draft. It is not enabled until you save and enable this facility.");
    } catch { setUncertain(true); setMessage("Could not confirm whether the registration was created. Reload and check before retrying."); }
    finally { setBusy(false); }
  }

  function reviewSave(schema: typeof saveSiteBillingSettingSchema) {
    const parsed = schema.safeParse({ locationId: saved.locationId, stateCode, choice, enable: true });
    if (!parsed.success) showIssues(parsed.error.issues);
    else { setErrors({}); setEnableOpen(true); }
  }

  const showAddress = mode === "unregistered_override" || (mode === "registered_override" && !registrationId);
  return <section className="mt-5 max-w-3xl rounded-card border border-line bg-paper p-4 sm:p-5">
    <FacilityDraftGuard dirty={!reloading && (dirty || locked)} busy={locked} />
    <h2 className="font-display text-[16px] font-semibold">Financial identity</h2>
    <p className="mt-1 text-[13px] text-ink-2">{saved.enabled ? "Facility billing is enabled for this site." : "This facility uses the club default for billing until you choose to use its own settings for new bills."}</p>
    <p className="mt-2 text-[13px] text-ink-2">Saved source: {saved.choice.mode === "inherit" ? "Club default" : saved.choice.mode === "registered_override" ? "Facility registration" : "Facility unregistered"}.</p>
    <p className="mt-1 break-words text-[13px] text-ink-2">{saved.enabled ? "Effective issuer" : "Facility-specific issuer"}: {saved.effectiveIssuer ? `${saved.effectiveIssuer.legalName} · ${saved.effectiveIssuer.gstin ?? "Unregistered"} · ${GST_STATE_NAMES[saved.effectiveIssuer.stateCode] ?? saved.effectiveIssuer.stateCode}` : saved.enabled ? "Not configured" : "Not enabled; existing billing uses the club default"}</p>
    <label className="mt-4 block text-[13px] font-medium">Facility billing state
      <Select {...fieldProps("stateCode")} value={stateCode} onChange={(event) => setStateCode(event.target.value)} disabled={locked || uncertain}>
        <option value="">Select state</option>{GST_STATE_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </Select>{fieldError("stateCode")}
    </label>
    <fieldset className="mt-4 space-y-2" disabled={locked || uncertain}><legend className="text-[13px] font-medium">GST billing mode</legend>
      {([ ["inherit", "Inherit club default"], ["registered_override", "Custom registered"], ["unregistered_override", "Unregistered"] ] as const).map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-3 text-[14px]"><input {...(value === "inherit" ? fieldProps("mode") : {})} type="radio" name="billing-mode" value={value} checked={mode === value} onChange={() => { setMode(value); setMessage(null); }} />{label}</label>)}{fieldError("mode")}
    </fieldset>
    {mode === "registered_override" ? <label className="mt-3 block text-[13px] font-medium">Facility registration
      <Select {...fieldProps("registrationId")} value={registrationId} disabled={locked || uncertain} onChange={(event) => setRegistrationId(event.target.value)}><option value="">Create a registration</option>{saved.registrations.map((entry) => <option key={entry.id} value={entry.id}>{entry.issuer.legalName} · {entry.issuer.gstin}</option>)}</Select>{fieldError("registrationId")}
    </label> : null}
    {showAddress ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="block text-[13px] font-medium">Billing legal name<Input {...fieldProps("legalName")} value={legalName} onChange={(event) => setLegalName(event.target.value)} disabled={locked || uncertain} />{fieldError("legalName")}</label>
      <label className="block text-[13px] font-medium">Legal address line 1<Input {...fieldProps("line1")} value={address.line1} onChange={(event) => updateAddress("line1", event.target.value)} disabled={locked || uncertain} />{fieldError("line1")}</label>
      <label className="block text-[13px] font-medium">Legal address line 2 (optional)<Input {...fieldProps("line2")} value={address.line2 ?? ""} onChange={(event) => updateAddress("line2", event.target.value)} disabled={locked || uncertain} />{fieldError("line2")}</label>
      <label className="block text-[13px] font-medium">City<Input {...fieldProps("city")} value={address.city} onChange={(event) => updateAddress("city", event.target.value)} disabled={locked || uncertain} />{fieldError("city")}</label>
      <label className="block text-[13px] font-medium">PIN code<Input {...fieldProps("postalCode")} value={address.postalCode} inputMode="numeric" onChange={(event) => updateAddress("postalCode", event.target.value)} disabled={locked || uncertain} />{fieldError("postalCode")}</label>
      {mode === "registered_override" ? <label className="block text-[13px] font-medium">GSTIN<Input {...fieldProps("gstin")} value={newGstin} maxLength={15} onChange={(event) => setNewGstin(event.target.value)} disabled={locked || uncertain} />{fieldError("gstin")}</label> : null}
      {mode === "registered_override" ? <div><Button type="button" variant="secondary" disabled={locked || uncertain} onClick={() => void run(({ createBillingRegistrationSchema }) => createRegistration(createBillingRegistrationSchema))}>Create registration</Button><p className="mt-1 text-[12px] text-ink-2">Creating a registration does not enable facility billing.</p></div> : null}
    </div> : null}
    {mismatch ? <p role="alert" className="mt-3 text-[13px] text-ink-2">This facility’s state does not match the selected registration. Choose a compatible registration or review the facility state.</p> : null}
    {checking ? <p role="status" className="mt-3 text-[13px] text-ink-2">Checking billing details…</p> : message ? <p role={success ? "status" : "alert"} className="mt-3 text-[13px] text-ink-2">{message}</p> : null}
    <div className="mt-5 flex flex-wrap gap-3">
      <Button type="button" disabled={locked || uncertain || mismatch} onClick={() => void run(({ saveSiteBillingSettingSchema }) => saved.enabled ? reviewSave(saveSiteBillingSettingSchema) : save(false, saveSiteBillingSettingSchema))}>{checking ? "Checking…" : busy ? "Saving…" : saved.enabled ? "Review changes" : "Save draft"}</Button>
      {!saved.enabled ? <Button type="button" variant="secondary" disabled={locked || uncertain || mismatch} onClick={() => void run(({ saveSiteBillingSettingSchema }) => reviewSave(saveSiteBillingSettingSchema))}>Review and use for new bills</Button> : null}
      {dirty && !uncertain ? <Button type="button" variant="secondary" disabled={locked} onClick={() => setDiscardOpen(true)}>Discard changes</Button> : null}
      {uncertain ? <Button type="button" variant="secondary" disabled={busy} onClick={() => setReloadOpen(true)}>Reload and check saved state</Button> : null}
      {saved.choice.mode !== "inherit" ? <Button type="button" variant="secondary" disabled={locked || uncertain || dirty} onClick={() => setResetOpen(true)}>Reset to club default</Button> : null}
    </div>
    {dirty && saved.choice.mode !== "inherit" ? <p className="mt-2 text-[12px] text-ink-2">Save or discard your draft before resetting.</p> : null}
    <Dialog open={resetOpen} onOpenChange={setResetOpen} title="Reset to club default?" description={`Only ${saved.locationName} changes. Source: club default. Legal name: ${club.legalName ?? "not configured"}. GSTIN: ${club.gstin ?? "unregistered or not configured"}. State: ${club.stateCode ? GST_STATE_NAMES[club.stateCode] ?? club.stateCode : "not set"}. New bills use this identity if facility billing is enabled; past bills stay unchanged. Finish billing or void open café orders before changing billing identity.${resetMismatch ? " The club default state does not match this facility. Review the facility state or club default before resetting." : ""}`} footer={<><Button variant="secondary" onClick={() => setResetOpen(false)}>Cancel</Button><Button disabled={locked || resetMismatch} onClick={() => void runDirect(reset)}>Confirm reset</Button></>} />
    <Dialog open={enableOpen} onOpenChange={(open) => { if (!locked) setEnableOpen(open); }} title={`Review billing for ${saved.locationName}`} description={`Source: ${selectedSource}. Legal name: ${selectedName}. GSTIN: ${selectedGstin}. State: ${selectedState ? GST_STATE_NAMES[selectedState] ?? selectedState : "not set"}. New bills for this facility will use this identity; past bills stay unchanged. Finish billing or void open café orders first. Complete the identity and resolve any state mismatch before continuing.`} footer={<><Button variant="secondary" disabled={locked} onClick={() => setEnableOpen(false)}>Cancel</Button><Button disabled={locked || mismatch} onClick={() => void run(({ saveSiteBillingSettingSchema }) => { setEnableOpen(false); return save(true, saveSiteBillingSettingSchema); })}>{checking ? <span role="status">Checking…</span> : saved.enabled ? "Save changes" : "Use for new bills"}</Button></>} />
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen} title="Discard changes?" description={`Discard the unsaved draft for ${saved.locationName}. Saved settings and existing bills will not change.`} footer={<><Button variant="secondary" onClick={() => setDiscardOpen(false)}>Keep editing</Button><Button disabled={busy} onClick={discardDraft}>Discard changes</Button></>} />
    <Dialog open={reloadOpen} onOpenChange={setReloadOpen} title="Reload and check saved state?" description="The result of the last request is unknown. Reload to see what was saved; the current unsaved draft will be lost." footer={<><Button variant="secondary" onClick={() => setReloadOpen(false)}>Keep draft</Button><Button disabled={busy} onClick={() => { setReloadOpen(false); setReloading(true); }}>Reload and check</Button></>} />
  </section>;
}
