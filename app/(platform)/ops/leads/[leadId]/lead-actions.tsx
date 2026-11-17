"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertLeadAction,
  transitionLeadAction,
  completeLeadAction,
} from "@/lib/actions/platform-leads";
import type { ConvertLeadResult } from "@/db/platform-lead-conversion";
import type { LeadMutationResult } from "@/db/platform-leads";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { OpsCard, OpsPanel } from "@/components/ops/ops-primitives";
import { OpsWriteGate } from "@/components/ops/ops-display";

// O-10 — lifecycle + conversion island on the lead detail page.
//
// Ops redesign (28 October 2026): every control is the SHARED control,
// and the write permission is resolved on the server from the session
// role — a viewer sees the pipeline's state and the reason it cannot
// be moved, never a control that would fail on submit.

export function LeadActions({
  leadId,
  currentStatus,
  hasLinkedTenant = false,
  linkedTenantId,
  defaultSlug,
  defaultLocationName,
  defaultPreset,
  presetOptions,
  canWrite,
}: {
  leadId: string;
  currentStatus: string;
  hasLinkedTenant?: boolean;
  linkedTenantId?: string | null;
  defaultSlug: string;
  defaultLocationName: string;
  defaultPreset: string;
  presetOptions: ReadonlyArray<{ key: string; name: string }>;
  /** Resolved on the server from the session role. */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [completionReason, setCompletionReason] = useState("");
  const [convertResult, setConvertResult] = useState<ConvertLeadResult | null>(
    null,
  );

  function move(status: string, reason?: string) {
    setError(null);
    startTransition(async () => {
      const result: LeadMutationResult = await transitionLeadAction(leadId, {
        status,
        ...(reason ? { lostReason: reason } : {}),
        ...(status === "trial" && linkedTenantId ? { trialTenantId: linkedTenantId } : {}),
      });
      if (result.kind !== "ok") setError(result.message);
      router.refresh();
    });
  }

  function convert(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await convertLeadAction(null, formData);
      setConvertResult(result);
      router.refresh();
    });
  }

  function complete() {
    if (!linkedTenantId) return;
    setError(null);
    startTransition(async () => {
      const result = await completeLeadAction(leadId, linkedTenantId, completionReason);
      if (result.kind !== "ok") setError(result.message);
      router.refresh();
    });
  }

  const finished =
    currentStatus === "converted" || currentStatus === "lost";
  const showProvisionForm = currentStatus !== "converted" && !hasLinkedTenant;

  return (
    <div className="space-y-5">
      {!finished ? (
        <OpsCard className="p-5">
          <h2 className="font-display text-[16px] font-semibold text-ink">
            Pipeline
          </h2>
          <OpsWriteGate
            canWrite={canWrite}
            note={
              <>
                Read-only: this account can browse, not change, platform data.
                The lead is in the {currentStatus.replace("_", " ")} stage.
              </>
            }
          >
            <div className="mt-3 flex flex-wrap gap-2">
              {["qualified", "demo_booked", "lapsed"].map((status) => (
                <Button
                  key={status}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending || currentStatus === status}
                  onClick={() => move(status)}
                >
                  Mark {status.replace("_", " ")}
                </Button>
              ))}
              {linkedTenantId && currentStatus !== "trial" ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => move("trial")}
                >
                  Resume trial
                </Button>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="block min-w-0 grow">
                <span className="mb-1 block text-[12px] font-medium text-ink-2">
                  Lost reason (required to mark lost)
                </span>
                <Input
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                />
              </label>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={pending || lostReason.trim().length === 0}
                onClick={() => move("lost", lostReason.trim())}
              >
                Mark lost
              </Button>
            </div>
            {currentStatus === "trial" && linkedTenantId ? (
              <div className="mt-4 space-y-2">
                <p className="text-[13px] text-ink-2">Provisioning created a trial tenant. Completing business conversion is a separate audited decision.</p>
                <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Conversion reason (required)</span><Input value={completionReason} onChange={(e) => setCompletionReason(e.target.value)} maxLength={500} /></label>
                <Button type="button" variant="secondary" disabled={pending || !completionReason.trim()} onClick={complete}>Mark business conversion complete</Button>
              </div>
            ) : null}
          </OpsWriteGate>
        </OpsCard>
      ) : null}

      {showProvisionForm || convertResult ? (
        <OpsCard className="p-5">
          {showProvisionForm ? (
            <>
              <h2 className="font-display text-[16px] font-semibold text-ink">
                Provision trial tenant
              </h2>
              <p className="mt-1 text-[13px] text-ink-3">
                Creates the tenant, applies the preset chosen from the
                qualification answers, creates the additional locations and
                moves this lead to trial. Fee model, GST registration, collection
                mode and coach count are recorded for setup, not applied automatically.
              </p>
              <OpsWriteGate
                canWrite={canWrite}
                note={
                  <>
                    Read-only: this account can browse, not change, platform data.
                    An administrator provisions the trial tenant.
                </>
              }
            >
              <form action={convert} className="mt-4 space-y-3">
                <input type="hidden" name="leadId" value={leadId} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-ink-2">
                      Tenant slug
                    </span>
                    <Input name="slug" required defaultValue={defaultSlug} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-ink-2">
                      Primary location name
                    </span>
                    <Input
                      name="locationName"
                      required
                      defaultValue={defaultLocationName}
                    />
                  </label>
                </div>
                <p className="text-[13px] text-ink-2">The trial deadline is 14 days from provisioning; its exact time is shown in IST after creation.</p>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-ink-2">
                    Preset
                  </span>
                  <Select name="preset" defaultValue={defaultPreset}>
                    {presetOptions.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {preset.name} ({preset.key})
                      </option>
                    ))}
                  </Select>
                </label>
                <Button type="submit" variant="primary" disabled={pending}>
                  {pending ? "Provisioning…" : "Provision trial tenant"}
                </Button>
              </form>
            </OpsWriteGate>
            </>
          ) : null}
          {convertResult ? (
            <OpsPanel tone="info" className="mt-4" title="Provisioning result">
              {convertResult.kind === "ok" ? (
                <>
                  Trial tenant created with {convertResult.locationsCreated} location
                  {convertResult.locationsCreated === 1 ? "" : "s"}.{" "}
                  {convertResult.presetApplied ? (
                    <>Preset <span className="font-medium">{convertResult.preset}</span> was applied. </>
                  ) : (
                    <>The preset was not applied; setup needs attention. </>
                  )}
                  <a
                    href={`/ops/tenants/${convertResult.tenantId}`}
                    className="text-[var(--accent-ink)] underline underline-offset-2"
                  >
                    Open tenant
                  </a>
                  {convertResult.presetWarning ? (
                    <span className="mt-1 block text-ink-2">
                      {convertResult.presetWarning}
                    </span>
                  ) : null}
                </>
              ) : (
                <>{convertResult.message}{convertResult.tenantId ? <> <a href={`/ops/tenants/${convertResult.tenantId}`} className="underline">Open linked tenant</a></> : null}</>
              )}
            </OpsPanel>
          ) : null}
        </OpsCard>
      ) : null}

      {error ? (
        <OpsPanel tone="error" title="The change was not saved">
          {error}
        </OpsPanel>
      ) : null}
    </div>
  );
}
