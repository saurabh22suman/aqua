import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { OwnerCreateAction } from "@/components/owner-ui/owner-create-action";
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
  await requireLiveOwnerSettingsPage(ctx);
  const rows = await listInvitationsAction();
  return (
    <OwnerPage>
      <PageHeader
        title="Invitations"
        purpose="Pending and active logins. Revoking an active row removes that person's access to the academy."
        action={
          // The SAME shared create action as Staff and Members: one
          // accessible "Invite staff" action, floating on a phone and
          // labelled on a desktop. The page already requires staff.invite.
          <OwnerCreateAction
            href="/owner/staff/invitations/new"
            label="Invite staff"
            testId="staff-invite-action"
          />
        }
      />

      {/* ONE visible heading: the page title already names this page, so
          the card carries no second "Invitations" heading. The label
          keeps the section named for a screen reader. */}
      <section
        aria-label="Invitations"
        className="mt-5 rounded-card border border-line bg-paper p-5"
      >
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
