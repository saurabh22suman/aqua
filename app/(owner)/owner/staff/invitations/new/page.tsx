import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { listLocationsAction } from "@/lib/actions/people";
import { StaffInviteForm } from "@/components/staff-invite-form";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// Owner OpenPen management lane (29 October 2026).
//
// An invitation creates login access in one step, with an explicit role
// and location scope. The link is created here and shared by the owner;
// Delivery is not confirmed here, so the screen never claims delivery.
export default async function StaffInvitePage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.invite");
  await requireLiveOwnerSettingsPage(ctx);
  const locations = await listLocationsAction();
  return (
    <OwnerPage workflow="edit">
      <Link
        href="/owner/staff/invitations"
        className="mb-4 inline-flex min-h-11 items-center gap-1 text-[13px] text-ink-3 hover:text-ink"
      >
        <OwnerIcon name="left" size={16} />
        Invitations
      </Link>
      <PageHeader
        title={<>Invite staff</>}
        purpose={<>Choose a login role and review location access. Then copy the login
        link and share it directly with the person.</>}
      />

      {/* Scope guidance mirrors the explicit scope control in the form below.
          Every role chooses a reach; a blank scope is never "all locations". */}
      <p className="mt-4 max-w-[700px] border-l-[3px] border-[var(--accent)] bg-deck px-4 py-3 text-[13px] text-ink-2">
        Every invitation states its reach: selected facilities or the whole
        academy, including future facilities. Managers must choose explicitly,
        and the same explicit choice applies to every other role here. Review
        the role and scope before creating access.
      </p>

      <div className="mt-5 max-w-[700px]">
        <StaffInviteForm locations={locations} />
      </div>

      <p className="mt-4 max-w-[700px] text-[12.5px] leading-relaxed text-ink-3">
        Creating this invitation does not send anything. Next, generate a
        single-use login link from{" "}
        <Link
          href="/owner/staff/invitations"
          className="font-medium text-[var(--accent-ink)] underline underline-offset-2"
        >
          Invitations
        </Link>{" "}
        and share it directly with the person.
      </p>

      <p className="mt-2 text-[12.5px] text-ink-3">
        Just adding someone with no login?{" "}
        <Link
          href="/owner/staff/new"
          className="font-medium text-[var(--accent-ink)] underline underline-offset-2"
        >
          Add staff record
        </Link>
        .
      </p>
    </OwnerPage>
  );
}
