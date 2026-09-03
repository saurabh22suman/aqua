import Link from "next/link";
import { ChevronRight, Languages, ListChecks, Palette, Users } from "lucide-react";

// F-23 — settings surface. Branding (Phase 2.9), Terminology
// (Phase 2.10), Staff (Phase 3.5) and the onboarding checklist
// (Phase 2.8) live here; future settings (locations, business
// hours, holiday calendar) accumulate in the same list. Style
// follows the row pattern of the bottom-nav cards: icon | title
// + sub | chevron.
export default function Page() {
  return (
    <main className="px-5 pt-6 pb-8">
      <h1 className="font-display text-[19px] font-semibold capitalize">settings</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Tenant configuration — branding, vocabulary, staff, locations, hours.
      </p>

      <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">Setup</h2>
      <Link
        href="/owner/onboarding"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
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

      <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">Academy</h2>
      <Link
        href="/owner/settings/branding"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <Palette size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Branding</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Display name, short name and accent.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/settings/terminology"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <Languages size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Vocabulary</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Eight overridable terms — &quot;member&quot; becomes &quot;swimmer&quot; and so on.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/staff"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <Users size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Staff</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Coaches, receptionists, workers and accountants. Invite from there.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
    </main>
  );
}
