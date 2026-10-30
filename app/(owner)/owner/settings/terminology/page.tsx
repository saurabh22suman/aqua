import Link from "next/link";
import { LOCALES, WRITABLE_LOCALES, type Locale } from "@/lib/terminology/keys";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { TerminologyForm } from "@/components/terminology/terminology-form";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { BackLink } from "@/components/ui/BackLink";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

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
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  const params = await searchParams;
  const requested = params.locale;
  const locale: Locale = (LOCALES as readonly string[]).includes(requested ?? "")
    ? (requested as Locale)
    : "en";
  const canEditLocale = (WRITABLE_LOCALES as readonly string[]).includes(locale);

  const data = await getTerminologyAction();
  return (
    <OwnerPage>
      <BackLink href="/owner/settings" label="Settings" />

      <PageHeader
        title={<>Vocabulary</>}
        purpose={<>Eight terms the academy can rename. Database columns and exports stay canonical — only the visible wording changes.</>}
      />

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
                ? "bg-[var(--accent-strong)] text-paper"
                : "bg-deck text-ink-2"
            }`}
          >
            {LOCALE_LABEL[l]}
          </Link>
        ))}
      </nav>

      <p className="mt-3 text-[12px] text-ink-3">
        {canEditLocale
          ? "Editing English. The tenant's actual display locale lives on the coach / parent-side surfaces; this picker edits vocabulary only."
          : `${LOCALE_LABEL[locale]} vocabulary is read-only today — only English overrides can be saved.`}
      </p>

      <div className="mt-6">
        {/* Keyed by locale: switching locale must never retain the
            previous locale's editor state. */}
        <TerminologyForm
          key={locale}
          initial={data}
          locale={locale}
          editable={canEditLocale}
        />
      </div>
    </OwnerPage>
  );
}
