"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertLeadAction,
  transitionLeadAction,
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
  defaultSlug,
  defaultLocationName,
  defaultPreset,
  presetOptions,
  canWrite,
}: {
  leadId: string;
  currentStatus: string;
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
  const [convertResult, setConvertResult] = useState<ConvertLeadResult | null>(
    null,
  );

  function move(status: string, reason?: string) {
    setError(null);
    startTransition(async () => {
      const result: LeadMutationResult = await transitionLeadAction(leadId, {
        status,
        ...(reason ? { lostReason: reason } : {}),
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

  const finished =
    currentStatus === "converted" || currentStatus === "lost";

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
          </OpsWriteGate>
        </OpsCard>
      ) : null}

      {currentStatus !== "converted" ? (
        <OpsCard className="p-5">
          <h2 className="font-display text-[16px] font-semibold text-ink">
            Provision trial tenant
          </h2>
          <p className="mt-1 text-[13px] text-ink-3">
            Creates the tenant, applies the preset chosen from the
            qualification answers, creates the additional locations and
            moves this lead to trial. Revenue settings (fee model, GST,
            collections) land with the money module and stay on the lead
            until then.
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
          {convertResult ? (
            <OpsPanel tone="info" className="mt-4" title="Provisioning result">
              {convertResult.kind === "ok" ? (
                <>
                  Tenant provisioned with preset{" "}
                  <span className="font-medium">{convertResult.preset}</span>{" "}
                  and {convertResult.locationsCreated} location
                  {convertResult.locationsCreated === 1 ? "" : "s"}.{" "}
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
                convertResult.message
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
