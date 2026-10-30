import { buttonClasses } from "@/components/ui/Button";
import Link from "next/link";
import { listInvitationsAction } from "@/lib/actions/staff-invitations";
import { InvitationsBoard } from "@/components/invitations-board";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// Owner OpenPen management lane (29 October 2026).
//
// Staff access is separate from the directory: a person can hold a
// record without a login, and an invite carries an explicit role and
// location scope. Creating or sharing a link is not proof it was
// delivered; revocation has its own confirmation.
export default async function StaffInvitationsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.invite");
  const rows = await listInvitationsAction();
  return (
    <OwnerPage>
      <PageHeader
        title="Staff access"
        purpose="Pending and active logins. Revoking an active row removes that person's access to the academy."
        action={
          <Link
            href="/owner/staff/invitations/new"
            className={buttonClasses({ variant: "primary", size: "md" })}
          >
            Invite staff
          </Link>
        }
      />

      <section
        aria-labelledby="invitations-heading"
        className="mt-5 rounded-card border border-line bg-paper p-5"
      >
        <h2
          id="invitations-heading"
          className="font-display text-[16px] font-semibold text-ink"
        >
          Invitations
        </h2>
        <div className="mt-2">
          <InvitationsBoard rows={rows} />
        </div>
      </section>

      <p className="mt-4 border-l-[3px] border-[var(--accent)] bg-deck px-4 py-3 text-[12.5px] text-ink-2">
        Creating or sharing a login link is not proof it was delivered.
        Revocation uses a separate confirmation.
      </p>
    </OwnerPage>
  );
}
