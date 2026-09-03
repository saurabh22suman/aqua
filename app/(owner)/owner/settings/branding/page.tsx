import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getBrandingAction } from "@/lib/actions/branding";
import { BrandingForm } from "@/components/branding/branding-form";

// Phase 2.9 — owner branding editor. Setting display name and
// short name, and choosing an accent from the six approved
// values. Logo and mark upload is intentionally out of scope —
// see the PR description and docs/five-day-work-guide.md
// (no new dependency without asking).
export default async function BrandingSettingsPage() {
  const data = await getBrandingAction();
  return (
    <main className="px-5 pt-6 pb-8">
      <Link
        href="/owner/settings"
        className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink mb-4"
      >
        <ChevronLeft size={16} />
        Settings
      </Link>

      <h1 className="font-display text-[19px] font-semibold">Branding</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        The display name, short name and accent that show across the academy.
      </p>

      <div className="mt-6">
        <BrandingForm
          initial={{
            displayName: data.displayName ?? data.fallbackDisplayName,
            shortName: data.shortName ?? data.fallbackShortName,
            accent: data.accent,
          }}
        />
      </div>
    </main>
  );
}
