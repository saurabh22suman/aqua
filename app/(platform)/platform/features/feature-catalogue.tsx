"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  updateFeatureAction,
  type UpdateFeatureFormInput,
} from "@/lib/actions/platform-features";
import type { Feature } from "@/db/schema/platform";

// Phase 1.7 — feature catalogue client. Receives the SSR-fetched
// rows, owns per-row edit state.
//
// H1 — each edit row's form uses <form action={updateFeatureAction}>
// rather than onSubmit. Pre-hydration submit goes via POST to the
// action endpoint rather than falling through to a native GET that
// puts form fields (name, category, status) in the URL. Per-row
// useActionState surfaces errors inline; on success the row closes
// edit mode and the action's revalidatePath() refreshes the SSR data.

const STATUS_LABEL: Record<string, string> = {
  ga: "GA",
  beta: "Beta",
  internal: "Internal",
};

const STATUS_TONE: Record<string, string> = {
  ga: "bg-good-soft text-good",
  beta: "bg-warn-soft text-warn",
  internal: "bg-deck text-ink-2",
};

export function FeatureCatalogue({
  initial,
}: {
  initial: ReadonlyArray<Feature>;
}) {
  // Group by category for the visual order. Categories are
  // freeform text in the schema, so we sort alphabetically.
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

  return (
    <>
      {initial.length === 0 ? (
        <div className="mt-8 rounded-card bg-paper border border-line px-5 py-12 text-center">
          <p className="text-[15px] font-medium text-ink">No features yet</p>
          <p className="mt-2 text-[13px] text-ink-3">
            The catalogue is empty — `pnpm db:seed` populates it from
            `db/seed-platform.ts` on a fresh database.
          </p>
          <code className="mt-4 inline-block rounded-ctl bg-deck px-3 py-1 text-[12px] font-mono text-ink-2">
            pnpm db:seed
          </code>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {orderedCategories.map((cat) => (
            <section key={cat}>
              <h2 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
                {cat}
              </h2>
              <div className="rounded-card bg-paper border border-line overflow-hidden">
                <ul>
                  {(grouped.get(cat) ?? []).map((feature, idx) => (
                    <li
                      key={feature.key}
                      className={`px-4 py-3 ${
                        idx > 0 ? "border-t border-line" : ""
                      }`}
                    >
                      <CatalogueRow feature={feature} />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

// Per-row component so each row owns its own edit toggle and (when
// editing) its own pending/error state via useActionState.
function CatalogueRow({ feature }: { feature: Feature }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return <FeatureViewRow feature={feature} onEdit={() => setEditing(true)} />;
  }
  return <FeatureEditRow feature={feature} onCancel={() => setEditing(false)} />;
}

function FeatureViewRow({
  feature,
  onEdit,
}: {
  feature: Feature;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-ink">{feature.name}</p>
        <p className="mt-0.5 text-[12px] text-ink-3 font-mono">
          {feature.key}
        </p>
      </div>
      <span
        className={`text-[11px] font-medium px-3 py-1 rounded-pill ${
          STATUS_TONE[feature.status] ?? "bg-deck text-ink-2"
        }`}
      >
        {STATUS_LABEL[feature.status] ?? feature.status}
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
  // revalidatePath("/platform/features") so the SSR data updates
  // on the next render. The render below short-circuits before
  // rendering the form, avoiding stale-state echo.
  if (state?.kind === "ok") {
    onCancel();
    return null;
  }

  const error = state?.kind === "error" ? state.message : null;

  return (
    <form
      action={formAction}
      method="post"
      className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end"
    >
      <input type="hidden" name="key" value={feature.key} />
      <div>
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Key (immutable)
          </span>
          <span className="block w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[14px] font-mono text-ink-3">
            {feature.key}
          </span>
        </label>
      </div>
      <label className="block">
        <span className="block text-[12px] font-medium text-ink-2 mb-1">
          Name
        </span>
        <input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] text-ink focus:border-[var(--accent)] focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="block text-[12px] font-medium text-ink-2 mb-1">
          Category
        </span>
        <input
          name="category"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] text-ink focus:border-[var(--accent)] focus:outline-none"
        />
      </label>
      <div className="flex flex-wrap gap-2 md:justify-end">
        <select
          name="status"
          value={status}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "ga" || v === "beta" || v === "internal") {
              setStatus(v);
            }
          }}
          className="rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] text-ink focus:border-[var(--accent)] focus:outline-none"
          aria-label="Status"
        >
          <option value="ga">GA</option>
          <option value="beta">Beta</option>
          <option value="internal">Internal</option>
        </select>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-pill px-4 py-2 text-[13px] font-semibold text-white bg-[var(--accent)] transition-colors duration-150 disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save"}
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
      {error ? (
        <p
          role="alert"
          className="md:col-span-4 rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}