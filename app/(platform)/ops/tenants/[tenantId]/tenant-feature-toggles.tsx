"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  upsertTenantFeatureAction,
  type UpsertTenantFeatureResult,
} from "@/lib/actions/platform-features";
import { Button } from "@/components/ui/Button";
import { isMandatoryModule } from "@/lib/feature-flags";
import {
  OpsCardFlush,
  OpsEmptyState,
} from "@/components/ops/ops-primitives";
import {
  OpsStatusPill,
} from "@/components/ops/ops-display";

// Phase 1.8 — per-tenant feature toggle inline editor.
//
// H1 — each edit row's form uses <form action={upsertTenantFeatureAction}>
// rather than onSubmit. Pre-hydration submit goes via POST to the
// action endpoint; the action value (force-on / force-off / reset-to-plan)
// never appears as a query string.
//
// Ops redesign (28 October 2026): the rows are the shared Ops frame
// and the buttons are the SHARED Button, so an entitlement row and a
// tenant filter button are the same control. The write permission is
// resolved on the server from the session role: a viewer sees the
// resolved entitlement and the reason it cannot change it, never a
// toggle that would fail on submit.

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
const SOURCE_TONE: Record<FeatureSource, "neutral" | "good" | "late"> = {
  plan: "neutral",
  tenant_override: "good",
  denied: "late",
};

export function TenantFeatureToggles({
  tenantId,
  initial,
  canWrite,
}: {
  tenantId: string;
  initial: ReadonlyArray<{
    key: string;
    source: FeatureSource;
    expiresAt?: Date;
  }>;
  /** Resolved on the server from the session role. */
  canWrite: boolean;
}) {
  if (initial.length === 0) {
    return (
      <OpsEmptyState
        className="mt-3"
        title="No features on this plan"
        body={
          <>
            The tenant&apos;s plan has no GA features attached. The catalogue is
            editable at /ops/features; per-tenant overrides land only on
            features the plan already carries (or that the operator first
            enables via the catalogue).
          </>
        }
      />
    );
  }

  return (
    <OpsCardFlush className="mt-3">
      <ul>
        {initial.map((f) => (
          <li key={f.key} className="border-b border-line px-4 py-3 last:border-b-0">
            <TenantFeatureRow
              tenantId={tenantId}
              feature={f}
              canWrite={canWrite}
            />
          </li>
        ))}
      </ul>
    </OpsCardFlush>
  );
}

// Per-row component so each row owns its own edit toggle and
// pending/error state via useActionState.
function TenantFeatureRow({
  tenantId,
  feature,
  canWrite,
}: {
  tenantId: string;
  feature: { key: string; source: FeatureSource; expiresAt?: Date };
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <TenantFeatureViewRow
        feature={feature}
        canWrite={canWrite}
        onEdit={() => setEditing(true)}
      />
    );
  }
  return (
    <TenantFeatureEditRow
      tenantId={tenantId}
      featureKey={feature.key}
      currentSource={feature.source}
      currentExpiresAt={feature.expiresAt}
      onCancel={() => setEditing(false)}
    />
  );
}

function TenantFeatureViewRow({
  feature,
  onEdit,
  canWrite,
}: {
  feature: { key: string; source: FeatureSource; expiresAt?: Date };
  onEdit: () => void;
  canWrite: boolean;
}) {
  // F05 (human decision, 29 October 2026) — the core modules are
  // mandatory. The runtime keeps them on for every tenant whatever any
  // override says, so a switch here would store a row nothing reads.
  // The row is still shown, a stored override is still visible (it is
  // never deleted), and the module reads as included.
  const mandatory = isMandatoryModule(feature.key);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[14px] font-medium text-ink">{feature.key}</p>
        {mandatory ? (
          <p className="mt-0.5 text-[12px] text-ink-3">
            Core module — always on for every tenant.
            {feature.source === "plan" ? null : " A stored override is ignored."}
          </p>
        ) : feature.expiresAt ? (
          <p className="mt-0.5 text-[12px] text-ink-3">
            Override expires{" "}
            {new Date(feature.expiresAt).toISOString().slice(0, 10)}
          </p>
        ) : null}
      </div>
      <OpsStatusPill tone={mandatory ? "neutral" : SOURCE_TONE[feature.source]}>
        {mandatory ? "Mandatory" : SOURCE_LABEL[feature.source]}
      </OpsStatusPill>
      {canWrite && !mandatory ? (
        <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
      ) : null}
    </div>
  );
}

function TenantFeatureEditRow({
  tenantId,
  featureKey,
  currentSource,
  currentExpiresAt,
  onCancel,
}: {
  tenantId: string;
  featureKey: string;
  currentSource: FeatureSource;
  currentExpiresAt?: Date;
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
    // method="post" is pinned by scripts/e2e-platform-form-leak.ts;
    // suppress the case-only hydration warning React raises for
    // server-action forms (POST vs post).
    <form
      action={formAction} method="post" suppressHydrationWarning
      className="space-y-3"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="featureKey" value={featureKey} />
      {currentExpiresAt ? (
        <input type="hidden" name="expiresAt" value={new Date(currentExpiresAt).toISOString()} />
      ) : null}
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
        <Button
          type="submit"
          name="mode"
          value="enable"
          variant="primary"
          size="sm"
          disabled={isPending}
        >
          Force on
        </Button>
        <Button
          type="submit"
          name="mode"
          value="disable"
          variant="secondary"
          size="sm"
          disabled={isPending}
        >
          Force off
        </Button>
        <Button
          type="submit"
          name="mode"
          value="clear"
          variant="secondary"
          size="sm"
          disabled={isPending || currentSource === "plan"}
        >
          Reset to plan
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
