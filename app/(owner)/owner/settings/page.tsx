import Link from "next/link";
import { ChevronRight, ListChecks } from "lucide-react";

// F-23 — settings surface. Most sections land with Phase 2.9
// (branding) and 2.10 (terminology); today it carries only the
// onboarding checklist, so a brand-new tenant still has a way to
// reach the in-progress setup from the bottom-nav Settings entry.
// Each future section adopts the same row pattern below.
export default function Page() {
  return (
    <main className="px-5 pt-6 pb-8">
      <h1 className="font-display text-[19px] font-semibold capitalize">settings</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Tenant configuration. Branding and vocabulary editing land in the next two phases.
      </p>

      <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">Setup</h2>
      <Link
        href="/owner/onboarding"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-warn-soft text-warn">
          <ListChecks size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Onboarding checklist</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            See what&apos;s left before members and coaches are ready to go.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
    </main>
  );
}
