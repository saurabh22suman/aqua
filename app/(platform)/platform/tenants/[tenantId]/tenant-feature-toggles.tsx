"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  upsertTenantFeatureAction,
  type UpsertTenantFeatureResult,
} from "@/lib/actions/platform-features";

// Phase 1.8 — per-tenant feature toggle inline editor.
//
// H1 — each edit row's form uses <form action={upsertTenantFeatureAction}>
// rather than onSubmit. Pre-hydration submit goes via POST to the
// action endpoint; the action value (force-on / force-off / reset-to-plan)
// never appears as a query string.

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
    <div className="rounded-card bg-paper border border-line overflow-hidden">
      <ul>
        {initial.map((f, idx) => (
          <li
            key={f.key}
            className={`px-4 py-3 ${idx > 0 ? "border-t border-line" : ""}`}
          >
            <TenantFeatureRow tenantId={tenantId} feature={f} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// Per-row component so each row owns its own edit toggle and
// pending/error state via useActionState.
function TenantFeatureRow({
  tenantId,
  feature,
}: {
  tenantId: string;
  feature: { key: string; source: FeatureSource; expiresAt?: Date };
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <TenantFeatureViewRow
        feature={feature}
        onEdit={() => setEditing(true)}
      />
    );
  }
  return (
    <TenantFeatureEditRow
      tenantId={tenantId}
      featureKey={feature.key}
      currentSource={feature.source}
      onCancel={() => setEditing(false)}
    />
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
  tenantId,
  featureKey,
  currentSource,
  onCancel,
}: {
  tenantId: string;
  featureKey: string;
  currentSource: FeatureSource;
  onCancel: () => void;
}) {
  const [state, formAction, isPending] = useActionState(upsertTenantFeatureAction, {
    kind: "error",
    code: "invalid",
    message: "",
  } as UpsertTenantFeatureResult);

  // On success, close the edit row. The action's revalidatePath()
  // refreshes the SSR data on the next render.
  if (state?.kind === "ok") {
    onCancel();
    return null;
  }

  const error = state?.kind === "error" ? state.message : null;

  return (
    <form
      action={formAction}
      method="post"
      className="space-y-3"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="featureKey" value={featureKey} />
      <p className="text-[13px] text-ink-2">
        Editing <span className="font-mono">{featureKey}</span> · currently{" "}
        <span className="font-medium">{SOURCE_LABEL[currentSource]}</span>
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="mode"
          value="override"
          // H1: enabled vs disabled is a separate form field. The
          // action reads enabled from formData. A boolean false
          // becomes "false" string. Use a hidden input rather than
          // a checkbox so the value is always sent.
          onClick={(e) => {
            const form = e.currentTarget.form;
            if (form) {
              const hidden = form.elements.namedItem("enabled") as HTMLInputElement | null;
              if (hidden) hidden.value = "true";
            }
          }}
          disabled={isPending}
          className="rounded-pill px-4 py-2 text-[13px] font-medium text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60 transition-colors duration-150"
        >
          Force on
        </button>
        <button
          type="submit"
          name="mode"
          value="override"
          onClick={(e) => {
            const form = e.currentTarget.form;
            if (form) {
              const hidden = form.elements.namedItem("enabled") as HTMLInputElement | null;
              if (hidden) hidden.value = "false";
            }
          }}
          disabled={isPending}
          className="rounded-pill px-4 py-2 text-[13px] font-medium text-ink-2 border border-line hover:bg-deck disabled:opacity-60 transition-colors duration-150"
        >
          Force off
        </button>
        <button
          type="submit"
          name="mode"
          value="clear"
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
      <input type="hidden" name="enabled" value="true" />
    </form>
  );
}