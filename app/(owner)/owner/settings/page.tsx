import Link from "next/link";
import { LogOut, ChevronRight, Languages, ListChecks, Palette, Users } from "lucide-react";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { logoutTenantAction } from "@/lib/actions/tenant-auth";
import { requireOwner } from "@/lib/auth/surface-guard";

// F-23 — settings surface. Branding (Phase 2.9), Terminology
// (Phase 2.10), Staff (Phase 3.5) and the onboarding checklist
// (Phase 2.8) live here. Locations / business hours / holidays
// editors are NOT on this page today — those tables exist (per the
// audit: locations + tenant_holidays) but the owner-side editors
// are their own future tasks. The subtitle below says only what's
// actually reachable from this list; the follow-up tasks can grow
// it back.
//
// K2 — Account section at the foot of the page. The bottom nav's
// 4th slot is Settings (admin-y), not a "Me" tab, so the identity
// block + sign-out lives here instead. When a dedicated /owner/me
// lands it can replace this section in place.
export default async function Page() {
  await requireOwner();
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  const identity = await getCurrentStaffIdentity(ctx);

  return (
    <main className="px-5 pt-6 pb-8">
      <h1 className="font-display text-[19px] font-semibold">Settings</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Branding, vocabulary, staff and onboarding — everything the owner can change about the academy.
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

      <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">Account</h2>
      <section className="rounded-card border border-line bg-paper p-4">
        <p className="font-display text-[14px] font-semibold">
          {identity?.fullName ?? "Signed in"}
        </p>
        <p className="mt-1 text-[13px] text-ink-3 font-mono">
          {identity?.phone ?? "No phone on file"}
        </p>
      </section>
      <form action={logoutTenantAction} className="mt-3">
        <button
          type="submit"
          className="flex w-full items-center gap-2 rounded-card border border-line bg-paper px-4 py-3 text-[14px] font-medium text-ink hover:bg-paper/80"
        >
          <LogOut size={16} className="text-ink-3" />
          Sign out
        </button>
      </form>
    </main>
  );
}
