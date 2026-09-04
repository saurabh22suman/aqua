"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { applyPresetAction } from "@/lib/actions/platform-preset-apply";
import type { TenantListRow } from "@/db/platform-tenants";

// Phase 2.2b — preset apply form. Server data is the list of
// tenants the operator can apply the preset to; the form posts
// (tenantId, featureKey) to the server action and reflects the
// discriminated result.
//
// Composition: one dominant element — the "Apply" button. The
// tenant picker is a `<select>` above it; the preview breakdown
// lives on the parent page. State of the world: a disabled picker
// for tenants that already have a preset, an explicit explanation
// of why, with a verb CTA that does NOT pretend to offer an
// override — the engine has refused, and the operator's recourse
// is to edit by hand.

type Tenant = TenantListRow;

export function PresetDetailForm({
  presetKey,
  presetName,
  tenants,
}: {
  presetKey: string;
  presetName: string;
  tenants: ReadonlyArray<Tenant>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Track per-tenant-applied-state from the list. The list comes
  // server-rendered; the form's defaults are read once.
  const [tenantId, setTenantId] = useState<string>(
    tenants[0]?.id ?? "",
  );

  const selected = tenants.find((t) => t.id === tenantId);
  const selectedAlreadyApplied =
    selected?.presetKey !== null && selected?.presetKey !== undefined;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!tenantId) {
      setError("Pick a tenant first.");
      return;
    }
    startTransition(async () => {
      const result = await applyPresetAction({
        tenantId,
        featureKey: presetKey,
      });
      // The result kind drives the inline CTA. Successful apply →
      // jump to the tenant detail page so the operator sees the
      // seeded state (architecture §empty state: a fresh-apply
      // tenant has zero members and zero sessions, which is the
      // natural empty state of /platform/tenants/[id]).
      if (result.kind === "ok") {
        router.push(`/platform/tenants/${tenantId}`);
        return;
      }
      if (result.kind === "lock_active") {
        setError(result.message);
        return;
      }
      if (result.kind === "preset_not_found") {
        setError(
          "This preset was removed from the catalogue. Refresh to see the latest list.",
        );
        return;
      }
      if (result.kind === "tenant_not_found") {
        setError("That tenant no longer exists. Refresh the list.");
        return;
      }
      if (result.kind === "error") {
        setError(result.message);
        return;
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
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
