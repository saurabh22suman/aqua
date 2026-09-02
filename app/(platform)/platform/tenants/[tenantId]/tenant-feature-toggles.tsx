"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  upsertTenantFeatureAction,
  type UpsertTenantFeatureFormInput,
} from "@/lib/actions/platform-features";

// Phase 1.8 — per-tenant feature toggle inline editor.
//
// Renders one row per feature the tenant's effective set contains.
// Each row shows the resolved source (plan baseline vs operator
// override), and exposes a tiny inline form for the three edit
// moves: force-on, force-off, reset-to-plan.
//
// The row keeps the same shape as FeatureViewRow / FeatureEditRow
// from /platform/features/feature-catalogue.tsx so an operator
// moving between the catalogue and the tenant detail page sees
// the same interaction language.

type FeatureSource = "plan" | "tenant_override" | "denied";

const SOURCE_LABEL: Record<FeatureSource, string> = {
  plan: "Plan",
  tenant_override: "Override",
  denied: "Denied",
};

// Per source, colour treatment uses the neutral ink palette. None
// of the four feature sources are money / attendance state, so
// warn / late / water stay reserved for the runtime data layer
// (DESIGN.md §1.1). The label is the source of truth; colourblind
// readers see the same story.
const SOURCE_TONE: Record<FeatureSource, string> = {
  plan: "bg-deck text-ink-2",
  tenant_override: "bg-paper border border-[var(--accent)] text-ink",
  denied: "bg-ink-2/15 text-ink-2 line-through",
};

export function TenantFeatureToggles({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: ReadonlyArray<{
    key: string;
    source: FeatureSource;
    expiresAt?: Date;
  }>;
}) {
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(input: UpsertTenantFeatureFormInput) {
    startTransition(async () => {
      const result = await upsertTenantFeatureAction(tenantId, input);
      if (result.kind === "ok") {
        setEditingKey(null);
        setError(null);
        router.refresh();
        return;
      }
      setError(result.message);
    });
  }

  if (initial.length === 0) {
    return (
      <div className="rounded-card bg-paper border border-line px-5 py-8 text-center">
        <p className="text-[14px] font-medium text-ink">No features on this plan</p>
        <p className="mt-2 text-[13px] text-ink-3">
          The tenant&apos;s plan has no GA features attached. The
          catalogue is editable at /platform/features; per-tenant
          overrides land only on features the plan already carries
          (or that the operator first enables via the catalogue).
        </p>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-ctl border border-late bg-late-soft px-3 py-2 text-[13px] text-late"
        >
          {error}
        </p>
      ) : null}
      <div className="rounded-card bg-paper border border-line overflow-hidden">
        <ul>
          {initial.map((f, idx) => (
            <li
              key={f.key}
              className={`px-4 py-3 ${idx > 0 ? "border-t border-line" : ""}`}
            >
              {editingKey === f.key ? (
                <TenantFeatureEditRow
                  featureKey={f.key}
                  currentSource={f.source}
                  isPending={isPending}
                  onCancel={() => {
                    setEditingKey(null);
                    setError(null);
                  }}
                  onSubmit={submit}
                />
              ) : (
                <TenantFeatureViewRow
                  feature={f}
                  onEdit={() => {
                    setEditingKey(f.key);
                    setError(null);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function TenantFeatureViewRow({
  feature,
  onEdit,
}: {
  feature: { key: string; source: FeatureSource; expiresAt?: Date };
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-ink font-mono">
          {feature.key}
        </p>
        {feature.expiresAt ? (
          <p className="mt-0.5 text-[12px] text-ink-3">
            Override expires{" "}
            {new Date(feature.expiresAt).toISOString().slice(0, 10)}
          </p>
        ) : null}
      </div>
      <span
        className={`text-[11px] font-medium px-3 py-1 rounded-pill ${SOURCE_TONE[feature.source]}`}
      >
        {SOURCE_LABEL[feature.source]}
      </span>
      <button
        type="button"
        onClick={onEdit}
        className="rounded-pill px-4 py-2 text-[13px] font-medium text-ink-2 border border-line hover:bg-deck transition-colors duration-150"
      >
        Edit
      </button>
    </div>
  );
}

function TenantFeatureEditRow({
  featureKey,
  currentSource,
  isPending,
  onCancel,
  onSubmit,
}: {
  featureKey: string;
  currentSource: FeatureSource;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (input: UpsertTenantFeatureFormInput) => void;
}) {
  // The form posts one of three outcomes:
  //   - force on  → mode=override, enabled=true
  //   - force off → mode=override, enabled=false
  //   - reset to plan → mode=clear
  // The current state is shown above the buttons so the operator
  // can see what they're changing FROM.
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const action = String(form.get("action") ?? "");
        if (action === "force-on") {
          onSubmit({ featureKey, mode: "override", enabled: true });
        } else if (action === "force-off") {
          onSubmit({ featureKey, mode: "override", enabled: false });
        } else if (action === "reset-to-plan") {
          onSubmit({ featureKey, mode: "clear", enabled: true });
        }
      }}
      className="space-y-3"
    >
      <p className="text-[13px] text-ink-2">
        Editing <span className="font-mono">{featureKey}</span> · currently{" "}
        <span className="font-medium">{SOURCE_LABEL[currentSource]}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="action"
          value="force-on"
          disabled={isPending}
          className="rounded-pill px-4 py-2 text-[13px] font-medium text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60 transition-colors duration-150"
        >
          Force on
        </button>
        <button
          type="submit"
          name="action"
          value="force-off"
          disabled={isPending}
          className="rounded-pill px-4 py-2 text-[13px] font-medium text-ink-2 border border-line hover:bg-deck disabled:opacity-60 transition-colors duration-150"
        >
          Force off
        </button>
        <button
          type="submit"
          name="action"
          value="reset-to-plan"
          disabled={isPending || currentSource === "plan"}
          className="rounded-pill px-4 py-2 text-[13px] font-medium text-ink-2 border border-line hover:bg-deck disabled:opacity-40 transition-colors duration-150"
        >
          Reset to plan
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-pill px-3 py-2 text-[13px] font-medium text-ink-2 hover:text-ink hover:underline disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
