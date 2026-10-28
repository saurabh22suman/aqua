import Link from "next/link";
import { listStaffAction } from "@/lib/actions/staff";
import { listOwnerMembershipsAction } from "@/lib/actions/tenant-owner-reset";
import { StaffBoard } from "@/components/staff-board";
import { OwnerResetLinks } from "@/components/owner-reset-links";
import { buttonClasses } from "@/components/ui/Button";
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
      {/* Owner redesign (C2) — the directory is the main task, so the
          header carries exactly one dominant action (add a record) and
          the other destinations (roster, invitations, leave) sit in
          their own row below it. Recovery stays at the foot of the
          page, out of the primary row action. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[19px] font-semibold">Staff</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">
            The people who run the academy. Each person signs in with one
            role for this academy; someone can still work several jobs,
            like coaching and reception.
          </p>
        </div>
        <Link
          href="/owner/staff/new"
          className={buttonClasses({ variant: "primary", size: "md" })}
        >
          Add staff record
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href="/owner/staff/roster"
          className="inline-flex min-h-11 items-center rounded-pill px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:text-ink"
        >
          Roster
        </Link>
        <Link
          href="/owner/staff/invitations"
          className="inline-flex min-h-11 items-center rounded-pill px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:text-ink"
        >
          Invitations
        </Link>
        <Link
          href="/owner/staff/leave"
          className="inline-flex min-h-11 items-center rounded-pill px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:text-ink"
        >
          Leave
        </Link>
      </div>

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
