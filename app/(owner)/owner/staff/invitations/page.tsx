import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { OwnerCreateAction } from "@/components/owner-ui/owner-create-action";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { OwnerLink } from "@/components/owner-ui/owner-link";
import { listInvitationsAction } from "@/lib/actions/staff-invitations";
import { InvitationsBoard } from "@/components/invitations-board";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import type { InvitationState } from "@/components/invitations-board";

// Owner OpenPen management lane (29 October 2026).
//
// Staff access is separate from the directory: a person can hold a
// record without a login, and an invite carries an explicit role and
// location scope. Creating or sharing a link is not proof it was
// delivered; revocation has its own confirmation.
const INVITATION_STATES: InvitationState[] = [
  "all",
  "invited",
  "active",
  "revoked",
];

function readState(value: string | undefined): InvitationState {
  return INVITATION_STATES.find((state) => state === value) ?? "all";
}

export default async function StaffInvitationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ state?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.invite");
  await requireLiveOwnerSettingsPage(ctx);
  const rows = await listInvitationsAction();
  const state = readState((await searchParams)?.state);
  const compactOwner = ctx.roleKey === "owner";
  return (
    <OwnerPage workflow="directory">
      <PageHeader
        title="Invitations"
        purpose={compactOwner ? "Manage sign-in access." : "Pending, active and revoked login access. Filter by state or find a person, then issue a single-use link or revoke access."}
        action={compactOwner ? (
          <OwnerLink
            href="/owner/staff/invitations/new"
            className={buttonClasses({ variant: "primary", size: "sm" })}
            data-testid="staff-invite-action"
          >
            <OwnerIcon name="plus" size={16} />
            Invite staff
          </OwnerLink>
        ) : (
          <OwnerCreateAction
            href="/owner/staff/invitations/new"
            label="Invite staff"
            testId="staff-invite-action"
          />
        )}
      />

      {/* ONE visible heading: the page title already names this page, so
          the card carries no second "Invitations" heading. The label
          keeps the section named for a screen reader. */}
      <section
        aria-label="Invitations"
        className={compactOwner ? "mt-4" : "mt-5 rounded-card border border-line bg-paper p-5"}
      >
        <div className={compactOwner ? undefined : "mt-2"}>
          <InvitationsBoard compactFilters={compactOwner} rows={rows} state={state} />
        </div>
      </section>

      <p className="mt-4 border-l-[3px] border-[var(--accent)] bg-deck px-4 py-3 text-[12.5px] text-ink-2">
        Creating or sharing a login link is not proof it was delivered.
        Revocation uses a separate confirmation.
      </p>
    </OwnerPage>
  );
}
