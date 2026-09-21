import Link from "next/link";
import { listStaffAction } from "@/lib/actions/staff";
import { listOwnerMembershipsAction } from "@/lib/actions/tenant-owner-reset";
import { StaffBoard } from "@/components/staff-board";
import { OwnerResetLinks } from "@/components/owner-reset-links";
import { requireOwner } from "@/lib/auth/surface-guard";

// Phase 3.5 — staff directory. List page reachable from
// Settings > Academy. Invitations surface links from here.
// PR2-C4 — owner access recovery lives at the foot of the page.
export default async function StaffListPage() {
  await requireOwner();
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
            className="rounded-pill px-4 py-2 text-[13px] font-semibold text-ink-2 bg-deck"
          >
            Roster
          </Link>
          <Link
            href="/owner/staff/invitations"
            className="rounded-pill px-4 py-2 text-[13px] font-semibold text-ink-2 bg-deck"
          >
            Invitations
          </Link>
          <Link
            href="/owner/staff/new"
            className="rounded-pill px-4 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)]"
          >
            Add staff
          </Link>
        </div>
      </div>

      <p className="text-[13px] text-ink-3">
        The people who run the academy. A single person can hold multiple roles (e.g. coach and receptionist).
      </p>

      <div className="mt-5">
        <StaffBoard rows={rows} />
      </div>

      {owners.length > 0 ? <OwnerResetLinks owners={owners} /> : null}
    </main>
  );
}
