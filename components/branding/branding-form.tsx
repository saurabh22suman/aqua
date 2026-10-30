"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import Loader2 from "lucide-react/dist/esm/icons/loader-2.mjs";
import Save from "lucide-react/dist/esm/icons/save.mjs";
import { useState, useTransition } from "react";
import { updateBrandingAction } from "@/lib/actions/branding";
import { TenantMark } from "@/components/branding/tenant-mark";
import {
  ACCENTS,
  ACCENT_KEYS,
  type AccentKey,
} from "@/lib/branding/accents";
import { deriveInitials } from "@/lib/branding/accents";

// Phase 2.9 — owner branding editor. One primary action: Save.
// The reference pairs a bounded editor with a live identity preview, so
// at desktop the form sits left and the preview right; a phone reads the
// preview first and the editor below. The mark and name are the same
// TenantMark the navigation surfaces use, so changes are visible before
// saving without inventing a second branding surface.
//
// The accent picker is six swatches with a single-select visible state;
// no free-text hex input — the brand-accent lint rule will fail the build
// if a future contributor tries to add one.

const ACCENT_LABELS: Record<AccentKey, string> = {
  mango: "Mango",
  marine: "Marine",
  indigo: "Indigo",
  plum: "Plum",
  forest: "Forest",
  slate: "Slate",
};

type FormState = {
  displayName: string;
  shortName: string;
  accent: AccentKey;
};

export function BrandingForm({ initial }: { initial: FormState }) {
  const [state, setState] = useState<FormState>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateBrandingAction({
          displayName: state.displayName.trim() || undefined,
          shortName: state.shortName.trim() || undefined,
          accent: state.accent,
        });
        if (result.kind === "error") {
          setError(result.message);
        } else {
          setSavedAt(new Date());
        }
      } catch {
        setError(
          "The change did not reach the server. Your edits are kept — try again.",
        );
      }
    });
  }

  const initials = deriveInitials(state.shortName || initial.shortName || "");
  const displayName = state.displayName || initial.displayName;

  return (
    <div className="grid gap-5 lg:grid-cols-5 lg:items-start">
      <div className="order-2 min-w-0 lg:order-1 lg:col-span-3 lg:col-start-1 lg:row-start-1">
        <div className="rounded-card border border-line bg-paper p-5">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium">
                Display name
              </span>
              <Input
                type="text"
                value={state.displayName}
                onChange={(e) => {
                  setState({ ...state, displayName: e.target.value });
                  setSavedAt(null);
                }}
                placeholder="Salt Lake Aquatics"
                maxLength={200}
                className="w-full"
                data-testid="branding-display-name"
              />
              <span className="mt-1 block text-[12px] text-ink-3">
                Shown across every surface — the dashboard, reports, registers,
                and the login screens.
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium">
                Short name
              </span>
              <Input
                type="text"
                value={state.shortName}
                onChange={(e) => {
                  setState({ ...state, shortName: e.target.value });
                  setSavedAt(null);
                }}
                placeholder="SLA"
                maxLength={40}
                className="w-full"
                data-testid="branding-short-name"
              />
              <span className="mt-1 block text-[12px] text-ink-3">
                Used to build the fallback initials mark. Two or fewer words
                work best.
              </span>
            </label>

            <div>
              <span className="mb-1.5 block text-[12.5px] font-medium">
                Accent
              </span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="branding-accent">
                {ACCENT_KEYS.map((key) => {
                  const isActive = state.accent === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setState({ ...state, accent: key });
                        setSavedAt(null);
                      }}
                      className={`flex min-h-11 items-center gap-2 rounded-ctl border px-3 py-2.5 transition-colors duration-150 ${
                        isActive
                          ? "border-ink bg-paper"
                          : "border-line bg-paper hover:border-ink-3"
                      }`}
                      aria-pressed={isActive}
                    >
                      <span
                        className="h-6 w-6 flex-none rounded-pill"
                        style={{ backgroundColor: ACCENTS[key].base }}
                        aria-hidden="true"
                      />
                      <span className="text-[13px] font-medium">
                        {ACCENT_LABELS[key]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <span className="mt-1.5 block text-[12px] text-ink-3">
                Paints the academy mark only — the mark in the preview. The
                workspace theme owns the buttons and the focus ring; status
                colours never change.
              </span>
            </div>
          </div>

          {error ? (
            <p className="mt-4 text-[13px] text-ink-3" role="alert">
              {error}
            </p>
          ) : null}
          {savedAt && !error ? (
            <p className="mt-4 text-[13px] text-ink-3" role="status">
              Saved. Changes apply everywhere at once.
            </p>
          ) : null}

          <Button
            variant="primary"
            size="md"
            className="mt-6 flex w-full items-center justify-center gap-2"
            type="button"
            onClick={submit}
            disabled={pending}
            data-testid="branding-save"
          >
            {pending ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Save size={16} aria-hidden="true" />
            )}
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <aside
        className="order-1 min-w-0 lg:order-2 lg:col-span-2 lg:col-start-4 lg:row-start-1"
        data-testid="branding-preview"
      >
        <div className="rounded-card border border-line bg-paper p-5">
          <h2 className="font-display text-[16px] font-semibold">
            Identity preview
          </h2>
          <div className="mt-4 flex items-center gap-4">
            <TenantMark
              initials={initials}
              accent={state.accent}
              size={56}
            />
            <div className="min-w-0 flex-1">
              <p
                className="break-words font-display text-[17px] font-semibold leading-tight"
                title={displayName}
              >
                {displayName}
              </p>
              <p className="mt-0.5 break-words text-[12.5px] text-ink-3">
                {state.shortName
                  ? `“${state.shortName}”`
                  : "No short name yet — initials come from the academy name."}
              </p>
            </div>
          </div>
          <p className="mt-4 text-[12px] text-ink-3">
            This is the mark and name shown across the workspace. Saving applies
            the change everywhere at once.
          </p>
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              What the accent changes
            </p>
            <p className="mt-2 text-[12px] text-ink-3">
              The accent changes the mark above and nothing else. Buttons, the
              active navigation and the focus ring follow the workspace theme —
              Mint or Lavender — and status colours keep their meaning.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
