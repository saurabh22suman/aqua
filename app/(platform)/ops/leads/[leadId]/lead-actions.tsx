"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertLeadAction,
  transitionLeadAction,
} from "@/lib/actions/platform-leads";
import type { ConvertLeadResult } from "@/db/platform-lead-conversion";
import type { LeadMutationResult } from "@/db/platform-leads";

// O-10 — lifecycle + conversion island on the lead detail page.

const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] text-ink focus:border-[var(--accent)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

export function LeadActions({
  leadId,
  currentStatus,
  defaultSlug,
  defaultLocationName,
  defaultPreset,
  presetOptions,
}: {
  leadId: string;
  currentStatus: string;
  defaultSlug: string;
  defaultLocationName: string;
  defaultPreset: string;
  presetOptions: ReadonlyArray<{ key: string; name: string }>;
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
    <div className="space-y-6">
      {!finished ? (
        <section className="rounded-card bg-paper border border-line p-5 space-y-3">
          <h2 className="font-display text-[16px] font-semibold text-ink">
            Pipeline
          </h2>
          <div className="flex flex-wrap gap-2">
            {["qualified", "demo_booked", "lapsed"].map((status) => (
              <button
                key={status}
                type="button"
                disabled={pending || currentStatus === status}
                onClick={() => move(status)}
                className="rounded-pill border border-line px-4 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink disabled:opacity-50"
              >
                Mark {status.replace("_", " ")}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block grow">
              <span className="block text-[12px] font-medium text-ink-2 mb-1">
                Lost reason (required to mark lost)
              </span>
              <input
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                className={inputClass}
              />
            </label>
            <button
              type="button"
              disabled={pending || lostReason.trim().length === 0}
              onClick={() => move("lost", lostReason.trim())}
              className="rounded-pill border border-line px-4 py-2 text-[12px] font-medium text-ink-2 hover:text-ink disabled:opacity-50"
            >
              Mark lost
            </button>
          </div>
        </section>
      ) : null}

      {currentStatus !== "converted" ? (
        <section className="rounded-card bg-paper border border-line p-5 space-y-4">
          <h2 className="font-display text-[16px] font-semibold text-ink">
            Provision trial tenant
          </h2>
          <p className="text-[12px] text-ink-3">
            Creates the tenant, applies the preset chosen from the
            qualification answers, creates the additional locations and
            moves this lead to trial. Revenue settings (fee model, GST,
            collections) land with the money module and stay on the lead
            until then.
          </p>
          <form action={convert} className="space-y-3">
            <input type="hidden" name="leadId" value={leadId} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[12px] font-medium text-ink-2 mb-1">
                  Tenant slug
                </span>
                <input
                  name="slug"
                  required
                  defaultValue={defaultSlug}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="block text-[12px] font-medium text-ink-2 mb-1">
                  Primary location name
                </span>
                <input
                  name="locationName"
                  required
                  defaultValue={defaultLocationName}
                  className={inputClass}
                />
              </label>
            </div>
            <label className="block">
              <span className="block text-[12px] font-medium text-ink-2 mb-1">
                Preset
              </span>
              <select
                name="preset"
                defaultValue={defaultPreset}
                className={inputClass}
              >
                {presetOptions.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.name} ({preset.key})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={pending}
              className="rounded-pill px-6 py-2.5 text-[14px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Provisioning…" : "Provision trial tenant"}
            </button>
          </form>
          {convertResult ? (
            <p
              role="status"
              className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
            >
              {convertResult.kind === "ok" ? (
                <>
                  Tenant provisioned with preset{" "}
                  <span className="font-medium">{convertResult.preset}</span>{" "}
                  and {convertResult.locationsCreated} location
                  {convertResult.locationsCreated === 1 ? "" : "s"}.{" "}
                  <a
                    href={`/ops/tenants/${convertResult.tenantId}`}
                    className="text-[var(--accent)] underline underline-offset-2"
                  >
                    Open tenant
                  </a>
                </>
              ) : (
                convertResult.message
              )}
            </p>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}
