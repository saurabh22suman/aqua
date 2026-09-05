"use client";

import { useActionState } from "react";
import { useState } from "react";
import Link from "next/link";
import {
  applyPresetAction,
  type ApplyPresetActionResult,
} from "@/lib/actions/platform-preset-apply";

// Phase 2.2b — applyPreset client island. Lives on /platform/presets/[key].
//
// H1 — the form uses <form action={applyPresetAction}> rather than
// onSubmit. Pre-hydration submit goes via POST to the action
// endpoint; the tenantId + presetKey never appear in a query string.
// On success the action calls redirect() to the tenant detail page.

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  presetKey: string | null;
  presetVersion: number | null;
};

export function PresetDetailForm({
  presetKey,
  presetName,
  tenants,
}: {
  presetKey: string;
  presetName: string;
  tenants: ReadonlyArray<Tenant>;
}) {
  // The action returns a discriminated union; initial state is a
  // generic error-shaped value with an empty message (no inline
  // pill rendered until the action returns a non-empty error).
  const [state, formAction, isPending] = useActionState(applyPresetAction, {
    kind: "error",
    code: "invalid",
    message: "",
  } as ApplyPresetActionResult);

  // Track per-tenant-applied-state from the list. The list comes
  // server-rendered; the form's defaults are read once.
  const [tenantId, setTenantId] = useState<string>(
    tenants[0]?.id ?? "",
  );

  const selected = tenants.find((t) => t.id === tenantId);
  const selectedAlreadyApplied =
    selected?.presetKey !== null && selected?.presetKey !== undefined;

  const error = state?.kind === "error" ? state.message : null;

  return (
    <form action={formAction} method="post" className="mt-8 space-y-4">
      <input type="hidden" name="featureKey" value={presetKey} />
      <section className="rounded-card bg-paper border border-line p-5 space-y-4">
        <div>
          <h2 className="font-display text-[16px] font-semibold text-ink">
            Apply to a tenant
          </h2>
          <p className="mt-1 text-[13px] text-ink-3">
            The engine writes every row in one transaction. Applying
            twice does not duplicate. Switching from a different
            applied preset is refused.
          </p>
        </div>

        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Tenant
          </span>
          {tenants.length === 0 ? (
            <p className="mt-1 text-[13px] text-ink-3">
              No tenants yet.{" "}
              <Link
                href="/platform/tenants/new"
                className="text-[var(--accent)] underline underline-offset-2"
              >
                Create one
              </Link>{" "}
              first.
            </p>
          ) : (
            <select
              name="tenantId"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] text-ink focus:border-[var(--accent)] focus:outline-none"
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.slug}) — {t.status}
                  {t.presetKey
                    ? ` · preset: ${t.presetKey} v${t.presetVersion ?? "?"}`
                    : ""}
                </option>
              ))}
            </select>
          )}
        </label>

        {selectedAlreadyApplied ? (
          <p
            role="status"
            className="rounded-ctl border border-ink-2/30 bg-deck px-3 py-2 text-[12px] text-ink-2"
          >
            This tenant already has preset{" "}
            <span className="font-medium">{selected?.presetKey}</span> applied.
            The engine will refuse this apply and report a lock error
            — switching presets requires manual clean-up first.
          </p>
        ) : null}
      </section>

      {error ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || tenants.length === 0}
          className="rounded-pill px-6 py-2.5 text-[14px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60 transition-colors duration-150"
        >
          {isPending
            ? "Applying…"
            : `Apply ${presetName} to this tenant`}
        </button>
        <Link
          href="/platform/presets"
          className="rounded-pill px-4 py-2.5 text-[13px] font-medium text-ink-2 hover:text-ink hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}