"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  updateFeatureAction,
  type UpdateFeatureFormInput,
} from "@/lib/actions/platform-features";
import type { Feature } from "@/db/schema/platform";
import { Button } from "@/components/ui/Button";
import type { StatusTone } from "@/components/ui/StatusBadge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { OpsCardFlush, OpsEmptyState } from "@/components/ops/ops-primitives";
import { OpsStatusPill } from "@/components/ops/ops-display";

// Phase 1.7 — feature catalogue client. Receives the SSR-fetched
// rows, owns per-row edit state.
//
// H1 — each edit row's form uses <form action={updateFeatureAction}>
// rather than onSubmit. Pre-hydration submit goes via POST to the
// action endpoint rather than falling through to a native GET that
// puts form fields (name, category, status) in the URL. Per-row
// useActionState surfaces errors inline; on success the row closes
// edit mode and the action's revalidatePath() refreshes the SSR data.
//
// Ops redesign (28 October 2026): the row's controls are the SHARED
// controls, and the write permission is resolved on the server from the
// session role — a viewer sees the catalogue and the reason it cannot
// be changed.

const STATUS_LABEL: Record<string, string> = {
  ga: "GA",
  beta: "Beta",
  internal: "Internal",
};

const STATUS_TONE: Record<string, StatusTone> = {
  ga: "good",
  beta: "warn",
  internal: "neutral",
} as const;

export function FeatureCatalogue({
  initial,
  canWrite,
}: {
  initial: ReadonlyArray<Feature>;
  /** Resolved on the server from the session role. */
  canWrite: boolean;
}) {
  // Group by category for the visual order. Categories are
  // freeform text in the schema, so we sort alphabetically.
  // (Test-fixture rows are filtered by the server page before this
  // component is rendered — X-D4, lib/feature-artifacts.ts.)
  const grouped = new Map<string, Feature[]>();
  for (const f of initial) {
    const arr = grouped.get(f.category) ?? [];
    arr.push(f);
    grouped.set(f.category, arr);
  }
  const orderedCategories = Array.from(grouped.keys()).sort();
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (initial.length === 0) {
    return (
      <OpsEmptyState
        className="mt-6"
        title="No features yet"
        body={
          <>
            The catalogue is empty — <span className="font-mono">pnpm db:seed</span>{" "}
            populates it from <span className="font-mono">db/seed-platform.ts</span>{" "}
            on a fresh database.
          </>
        }
      />
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {orderedCategories.map((cat) => (
        <section key={cat}>
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
            {cat}
          </h2>
          <OpsCardFlush>
            <ul>
              {(grouped.get(cat) ?? []).map((feature) => (
                <li key={feature.key} className="border-b border-line px-4 py-3 last:border-b-0">
                  <CatalogueRow feature={feature} canWrite={canWrite} />
                </li>
              ))}
            </ul>
          </OpsCardFlush>
        </section>
      ))}
    </div>
  );
}

// Per-row component so each row owns its own edit toggle and (when
// editing) its own pending/error state via useActionState.
function CatalogueRow({
  feature,
  canWrite,
}: {
  feature: Feature;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <FeatureViewRow
        feature={feature}
        canWrite={canWrite}
        onEdit={() => setEditing(true)}
      />
    );
  }
  return <FeatureEditRow feature={feature} onCancel={() => setEditing(false)} />;
}

function FeatureViewRow({
  feature,
  onEdit,
  canWrite,
}: {
  feature: Feature;
  onEdit: () => void;
  canWrite: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-ink">{feature.name}</p>
        <p className="mt-0.5 font-mono text-[12px] text-ink-3">{feature.key}</p>
      </div>
      <OpsStatusPill tone={STATUS_TONE[feature.status] ?? "neutral"}>
        {STATUS_LABEL[feature.status] ?? feature.status}
      </OpsStatusPill>
      {canWrite ? (
        <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
      ) : null}
    </div>
  );
}

function FeatureEditRow({
  feature,
  onCancel,
}: {
  feature: Feature;
  onCancel: () => void;
}) {
  const [state, formAction, isPending] = useActionState(updateFeatureAction, null);
  const [name, setName] = useState(feature.name);
  const [category, setCategory] = useState(feature.category);
  // Schema columns are typed as `string` (the schema's CHECK
  // constraint is the source of truth, not the type), so the
  // initialiser casts through the zod-derived enum.
  const initialStatus: UpdateFeatureFormInput["status"] =
    feature.status === "beta" || feature.status === "internal"
      ? feature.status
      : "ga";
  const [status, setStatus] = useState<UpdateFeatureFormInput["status"]>(initialStatus);

  // On success, close the edit row. The action calls
  // revalidatePath("/ops/features") so the SSR data updates
  // on the next render. The render below short-circuits before
  // rendering the form, avoiding stale-state echo.
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
      className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_1fr_1fr_auto]"
    >
      <input type="hidden" name="key" value={feature.key} />
      <div>
        <span className="mb-1 block text-[12px] font-medium text-ink-2">
          Key (immutable)
        </span>
        <span className="block w-full rounded-ctl border border-line bg-deck px-4 py-2 font-mono text-[14px] text-ink-3">
          {feature.key}
        </span>
      </div>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-ink-2">Name</span>
        <Input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-ink-2">
          Category
        </span>
        <Input
          name="category"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2 md:justify-end">
        <Select
          name="status"
          value={status}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "ga" || v === "beta" || v === "internal") {
              setStatus(v);
            }
          }}
          aria-label="Status"
          className="w-auto"
        >
          <option value="ga">GA</option>
          <option value="beta">Beta</option>
          <option value="internal">Internal</option>
        </Select>
        <Button type="submit" variant="primary" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
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
      {error ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2 md:col-span-4"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
