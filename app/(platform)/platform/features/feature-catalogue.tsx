"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateFeatureAction,
  type UpdateFeatureFormInput,
} from "@/lib/actions/platform-features";
import type { Feature } from "@/db/schema/platform";

// Phase 1.7 — feature catalogue client. Receives the SSR-fetched
// rows, owns per-row edit state. Each row is either view-mode
// (key + name + category + status pill + Edit button) or
// edit-mode (input fields + Save / Cancel). One Server Action
// call per Save; the page is re-fetched on success via
// router.refresh() so the audit row timestamps and any other
// shared state stay in lock-step.

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
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Group by category for the visual order. Categories are
  // freeform text in the schema, so we sort alphabetically rather
  // than encoding any order at the type level.
  const grouped = new Map<string, Feature[]>();
  for (const f of initial) {
    const arr = grouped.get(f.category) ?? [];
    arr.push(f);
    grouped.set(f.category, arr);
  }
  const orderedCategories = Array.from(grouped.keys()).sort();
  // Stable alphabetical ordering inside each category.
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="mt-6 mb-3 rounded-ctl border border-late bg-late-soft px-3 py-2 text-[13px] text-late"
        >
          {error}
        </p>
      ) : null}
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
                    {editingKey === feature.key ? (
                      <FeatureEditRow
                        feature={feature}
                        isPending={isPending}
                        onCancel={() => {
                          setEditingKey(null);
                          setError(null);
                        }}
                        onSubmit={(next) => {
                          startTransition(async () => {
                            const result = await updateFeatureAction(
                              feature.key,
                              next,
                            );
                            if (result.kind === "ok") {
                              setEditingKey(null);
                              setError(null);
                              router.refresh();
                              return;
                            }
                            setError(result.message);
                          });
                        }}
                      />
                    ) : (
                      <FeatureViewRow
                        feature={feature}
                        onEdit={() => {
                          setEditingKey(feature.key);
                          setError(null);
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </>
  );
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
  isPending,
  onSubmit,
  onCancel,
}: {
  feature: Feature;
  isPending: boolean;
  onSubmit: (next: UpdateFeatureFormInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(feature.name);
  const [category, setCategory] = useState(feature.category);
  // Schema columns are typed as `string` (the schema's CHECK
  // constraint is the source of truth, not the type), so the
  // initialiser casts through the zod-derived enum. The select
  // onChange below narrows incoming values the same way.
  const initialStatus: UpdateFeatureFormInput["status"] =
    feature.status === "beta" || feature.status === "internal"
      ? feature.status
      : "ga";
  const [status, setStatus] =
    useState<UpdateFeatureFormInput["status"]>(initialStatus);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, category, status });
      }}
      className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end"
    >
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
    </form>
  );
}
