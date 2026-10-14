import Link from "next/link";
import { listStaffAction } from "@/lib/actions/staff";
import { listOwnerMembershipsAction } from "@/lib/actions/tenant-owner-reset";
import { StaffBoard } from "@/components/staff-board";
import { OwnerResetLinks } from "@/components/owner-reset-links";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";

// Phase 3.5 — staff directory. List page reachable from
// Settings > Academy. Invitations surface links from here.
// PR2-C4 — owner access recovery lives at the foot of the page.
export default async function StaffListPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.read");
  const [rows, owners] = await Promise.all([
    listStaffAction({}),
    listOwnerMembershipsAction(),
  ]);
  return (
    <main className="px-5 pt-6 pb-8">
      <div className="flex items-center justify-between gap-3 pb-4">
        <h1 className="font-display text-[19px] font-semibold">Staff</h1>
        <div className="flex gap-2">
          <Link
            href="/owner/staff/roster"
            className="inline-flex min-h-11 items-center rounded-pill px-4 py-2 text-[13px] font-semibold text-ink-2 bg-deck"
          >
            Roster
          </Link>
          <Link
            href="/owner/staff/invitations"
            className="inline-flex min-h-11 items-center rounded-pill px-4 py-2 text-[13px] font-semibold text-ink-2 bg-deck"
          >
            Invitations
          </Link>
          <Link
            href="/owner/staff/new"
            className="inline-flex min-h-11 items-center rounded-pill px-4 py-2 text-[13px] font-semibold text-paper bg-[var(--accent-strong)]"
          >
            Add staff
          </Link>
        </div>
      </div>

      <p className="text-[13px] text-ink-3">
        The people who run the academy. Each person signs in with one role
        for this academy; someone can still work several jobs, like coaching
        and reception.
      </p>

      <div className="mt-5">
        <StaffBoard rows={rows} />
      </div>

      {/* A06 — owner-credential recovery stays owner-only; Admin
          (staff.invite without Owner rank) must not see mint buttons
          for Owner reset links. The service enforces the same gate. */}
      {owners.length > 0 && ctx.roleKey === "owner" ? (
        <OwnerResetLinks owners={owners} />
      ) : null}
    </main>
  );
}
