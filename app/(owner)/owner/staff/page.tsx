import Link from "next/link";
import { listStaffAction } from "@/lib/actions/staff";
import { listOwnerMembershipsAction } from "@/lib/actions/tenant-owner-reset";
import { StaffBoard } from "@/components/staff-board";
import { OwnerResetLinks } from "@/components/owner-reset-links";
import { buttonClasses } from "@/components/ui/Button";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

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
    <OwnerPage>
      {/* Owner OpenPen management lane (29 October 2026) — the
          directory is the main task, so the header carries exactly one
          dominant action (add a record). Roster, invitations and leave
          are separate destinations in the toolbar above the table;
          recovery stays at the foot of the page, out of the row
          action. */}
      <PageHeader
        title="Staff"
        purpose="The people who run the academy, with their staff type and login access. Roster, invitations and leave are managed separately."
        action={
          <Link
            href="/owner/staff/new"
            className={buttonClasses({ variant: "primary", size: "md" })}
          >
            Add staff record
          </Link>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {[
          { href: "/owner/staff/roster", label: "Roster" },
          { href: "/owner/staff/invitations", label: "Invitations" },
          { href: "/owner/staff/leave", label: "Leave" },
        ].map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className={buttonClasses({ variant: "secondary", size: "md" })}
          >
            {entry.label}
          </Link>
        ))}
      </div>

      <section className="mt-5 rounded-card border border-line bg-paper p-5">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Team directory
        </h2>
        <div className="mt-1">
          <StaffBoard rows={rows} />
        </div>
      </section>

      {/* A06 — owner-credential recovery stays owner-only; Admin
          (staff.invite without Owner rank) must not see mint buttons
          for Owner reset links. The service enforces the same gate. */}
      {owners.length > 0 && ctx.roleKey === "owner" ? (
        <OwnerResetLinks owners={owners} />
      ) : null}
    </OwnerPage>
  );
}
