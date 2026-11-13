import { isLiveOwnerForSettings } from "@/lib/auth/owner-settings-page-guard";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { listStaffAction } from "@/lib/actions/staff";
import { listOwnerMembershipsAction } from "@/lib/actions/tenant-owner-reset";
import { StaffBoard } from "@/components/staff-board";
import { OwnerResetLinks } from "@/components/owner-reset-links";
import { OwnerCreateAction } from "@/components/owner-ui/owner-create-action";
import { OwnerIcon, type OwnerIconName } from "@/components/owner-ui/owner-icon";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// Phase 3.5 — staff directory. List page reachable from
// Settings > Academy. Invitations surface links from here.
// PR2-C4 — owner access recovery lives at the foot of the page.
export default async function StaffListPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.read");
  const canWriteStaff = hasPermission(ctx, "staff.write");
  const isLiveOwner = await isLiveOwnerForSettings(ctx);
  const canInviteStaff = isLiveOwner && hasPermission(ctx, "staff.invite");
  const canReadRecovery = canInviteStaff && hasPermission(ctx, "settings.read");
  const [rows, owners] = await Promise.all([
    listStaffAction({}),
    canReadRecovery ? listOwnerMembershipsAction() : Promise.resolve([]),
  ]);
  return (
    <OwnerPage>
      {/* The directory is the main task, so the header carries exactly one
          dominant action — the SAME shared create action as Members: the
          round floating action above the phone navigation and the inline
          labelled action on a desktop. Roster, invitations and leave are
          separate destinations in the toolbar above the table; recovery
          stays at the foot of the page, out of the row action. The
          permission is decided here, on the server: a caller with
          staff.read only is never offered a create affordance. */}
      <PageHeader
        title="Staff"
        action={
          canWriteStaff ? (
            <OwnerCreateAction
              href="/owner/staff/new"
              label="Add staff"
              testId="staff-create-action"
            />
          ) : null
        }
      />

      {/* The approved "Shortcuts" layout (human choice, 3 Nov 2026): three
          equal compact columns above the directory — a soft icon tile over a
          plain caption, no outlined button cages and no counts. The row is
          constrained on a desktop instead of stretching across the page.
          Check-in QR is NOT repeated here: the real destination is the
          "Check-in poster" link inside the roster page, which requires
          staff.roster.

          Each shortcut draws its OWN glyph, so three different
          destinations never look alike: the roster is the list, the
          invitation is the user-plus and leave is the calendar. The
          roster and leave used to share the calendar. */}
      <nav
        aria-label="Staff shortcuts"
        className="mt-4 grid max-w-md grid-cols-3 gap-1.5"
      >
        {[
          { href: "/owner/staff/roster", label: "Roster", icon: "programs" },
          ...(canInviteStaff
            ? [{ href: "/owner/staff/invitations", label: "Invitations", icon: "userplus" }]
            : []),
          { href: "/owner/staff/leave", label: "Leave", icon: "calendar" },
          ...(hasPermission(ctx, "staff.attendance") && hasFeature(ctx, "staff")
            ? [{ href: "/owner/staff/attendance", label: "Attendance", icon: "staff" }]
            : []),
        ].map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="flex min-h-11 flex-col items-center gap-2 rounded-ctl px-1 py-1 text-[13px] font-medium text-ink-2 hover:text-ink focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <span className="grid h-11 w-11 place-items-center rounded-[14px] bg-[var(--action-soft)] text-[var(--action-ink)]">
              <OwnerIcon name={entry.icon as OwnerIconName} size={22} />
            </span>
            {entry.label}
          </Link>
        ))}
      </nav>

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
      {owners.length > 0 && canReadRecovery ? (
        <details className="mt-5 rounded-card border border-line bg-paper p-4">
          <summary className="cursor-pointer font-medium">Owner access recovery</summary>
          <OwnerResetLinks owners={owners} />
        </details>
      ) : null}
    </OwnerPage>
  );
}
