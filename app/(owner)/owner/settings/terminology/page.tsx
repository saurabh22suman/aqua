import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { TerminologyForm } from "@/components/terminology/terminology-form";

// Phase 2.10 — owner vocabulary editor. Eight closed TERM_KEYS
// per architecture § 7.5; changing "member" to "swimmer"
// updates the app and leaves member_code untouched.
export default async function TerminologySettingsPage() {
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

      <div className="mt-6">
        <TerminologyForm initial={data} />
      </div>
    </main>
  );
}
