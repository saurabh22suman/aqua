import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { LOCALES, type Locale } from "@/lib/terminology/keys";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { TerminologyForm } from "@/components/terminology/terminology-form";

// Phase 2.10 / 4.20 — owner vocabulary editor. Eight closed
// TERM_KEYS per architecture § 7.5; per-locale override data
// lives at /owner/settings/terminology/[locale]. The locale is
// part of the URL so a switch is just a navigation — no internal
// "active locale" toggle in the form. Falling onto /en is the
// done-when for 2.10; /hi and /bn carry the same rows in the
// same shape, with the locale's defaults pre-baked into the
// resolved preview.
const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी (Hindi)",
  bn: "বাংলা (Bengali)",
};

export default async function TerminologySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const params = await searchParams;
  const requested = params.locale;
  const locale: Locale = (LOCALES as readonly string[]).includes(requested ?? "")
    ? (requested as Locale)
    : "en";

  const data = await getTerminologyAction();
  return (
    <main className="px-5 pt-6 pb-8">
      <Link
        href="/owner/settings"
        className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink mb-4"
      >
        <ChevronLeft size={16} />
        Settings
      </Link>

      <h1 className="font-display text-[19px] font-semibold">Vocabulary</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Eight terms the academy can rename. Database columns and exports stay canonical — only the visible wording changes.
      </p>

      <nav
        aria-label="Locale"
        className="mt-4 flex gap-2"
        data-testid="terminology-locale-picker"
      >
        {LOCALES.map((l) => (
          <Link
            key={l}
            href={`/owner/settings/terminology?locale=${l}`}
            aria-current={l === locale ? "page" : undefined}
            className={`min-h-[44px] inline-flex items-center px-4 rounded-pill text-[13px] font-medium ${
              l === locale
                ? "bg-[var(--accent)] text-paper"
                : "bg-deck text-ink-2"
            }`}
          >
            {LOCALE_LABEL[l]}
          </Link>
        ))}
      </nav>

      <p className="mt-3 text-[12px] text-ink-3">
        Editing <span className="text-ink-2 font-mono">{locale}</span>. The tenant&apos;s actual display locale lives on the coach / parent-side surfaces; this picker edits vocabulary only.
      </p>

      <div className="mt-6">
        <TerminologyForm initial={data} locale={locale} />
      </div>
    </main>
  );
}
