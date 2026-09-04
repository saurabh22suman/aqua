"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { updateBrandingAction } from "@/lib/actions/branding";
import { TenantMark } from "@/components/branding/tenant-mark";
import {
  ACCENTS,
  ACCENT_KEYS,
  type AccentKey,
} from "@/lib/branding/accents";
import { deriveInitials } from "@/lib/branding/accents";

// Phase 2.9 — owner branding editor. One primary action: Save.
// Above it, a live preview — the same TenantMark the navigation
// surfaces use, paired with the display name — so any change
// here is the change the owner sees everywhere. The preview is
// the dominant element, matching DESIGN.md's "one dominant
// element per screen" rule.
//
// The accent picker is six swatches with a single-select
// visible state; no free-text hex input — the brand-accent
// lint rule will fail the build if a future contributor tries
// to add one.

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
    });
  }

  const initials = deriveInitials(state.shortName || initial.shortName || "");

  return (
    <div>
      {/* Live preview — the dominant element. The same mark +
          name pair the rest of the app shows, so changes here
          update in place. */}
      <div className="bg-paper border border-line rounded-card px-5 py-5 flex items-center gap-4 mb-5">
        <TenantMark
          initials={initials}
          accent={state.accent}
          size={56}
        />
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold leading-tight truncate">
            {state.displayName || initial.displayName}
          </p>
          <p className="text-[12.5px] text-ink-3 mt-0.5 truncate">
            {state.shortName ? `“${state.shortName}”` : "No short name yet — initials come from the academy name."}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="block text-[12.5px] font-medium mb-1.5">Display name</span>
          <input
            type="text"
            value={state.displayName}
            onChange={(e) => {
              setState({ ...state, displayName: e.target.value });
              setSavedAt(null);
            }}
            placeholder="Salt Lake Aquatics"
            maxLength={200}
            className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px]"
            data-testid="branding-display-name"
          />
          <span className="block mt-1 text-[12px] text-ink-3">
            Shown on the home, parent page and any future receipt.
          </span>
        </label>

        <label className="block">
          <span className="block text-[12.5px] font-medium mb-1.5">Short name</span>
          <input
            type="text"
            value={state.shortName}
            onChange={(e) => {
              setState({ ...state, shortName: e.target.value });
              setSavedAt(null);
            }}
            placeholder="SLA"
            maxLength={40}
            className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px]"
            data-testid="branding-short-name"
          />
          <span className="block mt-1 text-[12px] text-ink-3">
            Used to build the fallback initials mark. Two or fewer words work best.
          </span>
        </label>

        <div>
          <span className="block text-[12.5px] font-medium mb-1.5">Accent</span>
          <div className="grid grid-cols-3 gap-2" data-testid="branding-accent">
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
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-ctl border transition-colors duration-150 min-h-[44px] ${
                    isActive
                      ? "border-ink bg-paper"
                      : "border-line bg-paper hover:border-ink-3"
                  }`}
                  aria-pressed={isActive}
                >
                  <span
                    className="h-6 w-6 rounded-pill flex-none"
                    style={{ backgroundColor: ACCENTS[key].base }}
                    aria-hidden="true"
                  />
                  <span className="text-[13px] font-medium">{ACCENT_LABELS[key]}</span>
                </button>
              );
            })}
          </div>
          <span className="block mt-1.5 text-[12px] text-ink-3">
            Applies to primary buttons and the mark itself. Status colours never change.
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

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-6 w-full rounded-pill py-4 text-[14.5px] font-semibold text-paper bg-[var(--accent)] transition-colors duration-150 flex items-center justify-center gap-2 disabled:opacity-70"
        data-testid="branding-save"
      >
        {pending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {pending ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
