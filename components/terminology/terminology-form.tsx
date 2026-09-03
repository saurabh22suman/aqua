"use client";

import { useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import {
  DEFAULT_TERMS,
  titleCase,
  type Locale,
  type TermKey,
  type TerminologyState,
} from "@/lib/terminology/keys";
import {
  updateTermOverrideAction,
  clearTermOverrideAction,
} from "@/lib/actions/terminology";

// Phase 2.10 + 4.20 — terminology editor. Eight rows, each
// with singular + plural forms, scoped to a single locale at a
// time (the page at /owner/settings/terminology/[locale] picks
// the locale; the URL is the source of truth so the form has no
// internal locale toggle). One primary CTA on the row saves
// just that row — saves are granular so the owner doesn't
// draft across all eight and find one row's input has rotted
// by the time they save. "Use default" restores the locale
// default for that key, which the resolveTerm() fallback
// picks up automatically (deletes the override key).
//
// Composition: the dominant element here is the row itself —
// each row shows the current rendering so the owner sees the
// change in place. The locale picker lives at the form level
// (the page route above) so this component stays locale-narrow.

type RowState = {
  one: string;
  other: string;
};

const ROW_KEYS: ReadonlyArray<{
  key: TermKey;
  label: string;
}> = [
  { key: "member", label: "Member" },
  { key: "batch", label: "Batch" },
  { key: "coach", label: "Coach" },
  { key: "session", label: "Session" },
  { key: "program", label: "Program" },
  { key: "facility", label: "Facility" },
  { key: "guardian", label: "Guardian" },
  { key: "enquiry", label: "Enquiry" },
];

// Per-locale sample sentence so the preview rendering shows
// the same language the user is editing. Defaults to English
// placeholders — translations land in the data-only R.20 pass.
const SAMPLE_SENTENCES: Record<Locale, { singular: (n: string) => string; plural: (n: string) => string }> = {
  en: {
    singular: (n: string) => `1 ${n} marked present`,
    plural: (n: string) => `12 ${n}s marked present`,
  },
  hi: {
    singular: (n: string) => `1 ${n} उपस्थित`,
    plural: (n: string) => `12 ${n} उपस्थित`,
  },
  bn: {
    singular: (n: string) => `1 ${n} উপস্থিত`,
    plural: (n: string) => `12 ${n} উপস্থিত`,
  },
};

export function TerminologyForm({
  initial,
  locale,
}: {
  initial: TerminologyState;
  locale: Locale;
}) {
  // Local form state — starts at the resolved values for *this*
  // locale (override wins on the row, otherwise locale default).
  const [overrides, setOverrides] = useState<Record<TermKey, RowState | undefined>>(() => {
    const out = {} as Record<TermKey, RowState | undefined>;
    for (const row of ROW_KEYS) {
      const loc = initial.overrides[row.key]?.[locale];
      out[row.key] = loc ? { one: loc.one, other: loc.other } : undefined;
    }
    return out;
  });
  const [pendingKey, setPendingKey] = useState<TermKey | null>(null);
  const [errors, setErrors] = useState<Partial<Record<TermKey, string>>>({});
  const [saved, setSaved] = useState<Partial<Record<TermKey, Date>>>({});

  // Preview state — keyed to the active locale — drives the
  // "Reads as:" sentence at the row top so the user sees the
  // change in place across all terms.
  const previewState: TerminologyState = {
    overrides: Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [k, v ? { [locale]: v } : undefined]),
    ) as TerminologyState["overrides"],
    locale,
  };

  function setRow(key: TermKey, partial: Partial<RowState>) {
    const prev = overrides[key] ?? {
      one: DEFAULT_TERMS[locale][key].one,
      other: DEFAULT_TERMS[locale][key].other,
    };
    setOverrides({ ...overrides, [key]: { ...prev, ...partial } });
    setSaved({ ...saved, [key]: undefined });
  }

  function saveRow(key: TermKey) {
    const row = overrides[key];
    if (!row) return;
    setPendingKey(key);
    setErrors({ ...errors, [key]: undefined });
    updateTermOverrideAction({
      key,
      locale,
      one: row.one.trim(),
      other: row.other.trim(),
    }).then((result) => {
      setPendingKey(null);
      if (result.kind === "error") {
        setErrors({ ...errors, [key]: result.message });
      } else {
        setSaved({ ...saved, [key]: new Date() });
      }
    });
  }

  function resetRow(key: TermKey) {
    setPendingKey(key);
    setErrors({ ...errors, [key]: undefined });
    clearTermOverrideAction({ key, locale }).then((result) => {
      setPendingKey(null);
      if (result.kind === "error") {
        setErrors({ ...errors, [key]: result.message });
      } else {
        // Reverted to locale defaults — drop the local override
        // so the inputs match the live state.
        setOverrides({ ...overrides, [key]: undefined });
        setSaved({ ...saved, [key]: new Date() });
      }
    });
  }

  const sample = SAMPLE_SENTENCES[locale];

  return (
    <ul className="space-y-3" data-testid={`terminology-form-${locale}`}>
      {ROW_KEYS.map((row) => {
        const defaults = DEFAULT_TERMS[locale][row.key];
        const oneRaw = overrides[row.key]?.one ?? defaults.one;
        const otherRaw = overrides[row.key]?.other ?? defaults.other;
        const oneInput = overrides[row.key]?.one ?? "";
        const otherInput = overrides[row.key]?.other ?? "";
        const isCustom = overrides[row.key] !== undefined;
        const isPending = pendingKey === row.key;
        const errorMsg = errors[row.key];
        const savedAt = saved[row.key];

        return (
          <li key={row.key} className="bg-paper border border-line rounded-ctl p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-display text-[14px] font-semibold">{titleCase(row.label)}</h3>
              <span className="text-[11px] uppercase tracking-wide text-ink-3">
                {isCustom ? "Custom" : "Default"}
              </span>
            </div>

            <p className="mt-1.5 text-[12.5px] text-ink-3">
              Reads as: <span className="text-ink-2">{sample.singular(oneRaw)}</span>{" "}
              ·{" "}
              <span className="text-ink-2">{sample.plural(otherRaw)}</span>
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="block text-[12px] text-ink-3 mb-1">Singular</span>
                <input
                  type="text"
                  value={oneInput}
                  onChange={(e) => setRow(row.key, { one: e.target.value })}
                  placeholder={defaults.one}
                  maxLength={60}
                  className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px] min-h-[44px]"
                  data-testid={`term-${row.key}-one`}
                />
              </label>
              <label className="block">
                <span className="block text-[12px] text-ink-3 mb-1">Plural</span>
                <input
                  type="text"
                  value={otherInput}
                  onChange={(e) => setRow(row.key, { other: e.target.value })}
                  placeholder={defaults.other}
                  maxLength={60}
                  className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px] min-h-[44px]"
                  data-testid={`term-${row.key}-other`}
                />
              </label>
            </div>

            {errorMsg ? (
              <p className="mt-2 text-[12.5px] text-late" role="alert">{errorMsg}</p>
            ) : null}
            {savedAt && !errorMsg ? (
              <p className="mt-2 text-[12.5px] text-good" role="status">Saved.</p>
            ) : null}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => saveRow(row.key)}
                disabled={isPending}
                className="flex-1 min-h-[44px] rounded-pill py-2.5 text-[13.5px] font-semibold text-paper bg-[var(--accent)] disabled:opacity-70 flex items-center justify-center gap-1.5"
                data-testid={`term-${row.key}-save`}
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
              {isCustom ? (
                <button
                  type="button"
                  onClick={() => resetRow(row.key)}
                  disabled={isPending}
                  className="min-h-[44px] rounded-pill py-2.5 px-3 text-[13px] font-medium bg-deck text-ink-2 disabled:opacity-50 flex items-center gap-1.5"
                  data-testid={`term-${row.key}-reset`}
                >
                  <RotateCcw size={13} /> Use default
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
      <ResolvePreviewNotice state={previewState} locale={locale} />
    </ul>
  );
}

function ResolvePreviewNotice({ state, locale }: { state: TerminologyState; locale: Locale }) {
  // Renders one line confirming what the closed-key resolver
  // sees for the active locale. The locale selector sits on
  // the page (above this component) — the form itself stays
  // locale-narrow, which is why the preview is also narrow.
  return (
    <li className="text-[12px] text-ink-3 px-1">
      Today&apos;s view uses{" "}
      <span className="text-ink">{titleCase(resolveTerm(state, "member", "other"))}</span>{" "}
      ·{" "}
      <span className="text-ink">{titleCase(resolveTerm(state, "batch", "other"))}</span>{" "}
      ·{" "}
      <span className="text-ink">{titleCase(resolveTerm(state, "session", "other"))}</span>
      . Database columns stay <span className="text-ink">member_code</span>, never renamed.
      <span className="block mt-0.5 text-ink-3">Active locale: <span className="text-ink-2 font-mono">{locale}</span></span>
    </li>
  );
}

// Touch locale-imported-after-render so the closure compiles
// even when SAMPLE_SENTENCES has only the 'en' branch populated.
// (At runtime the entry is required; this is just type-aware
// documentation that no entry silently regresses.)
import { resolveTerm } from "@/lib/terminology/keys";
void resolveTerm;
