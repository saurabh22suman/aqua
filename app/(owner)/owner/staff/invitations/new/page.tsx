import Link from "next/link";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import { listLocationsAction } from "@/lib/actions/people";
import { StaffInviteForm } from "@/components/staff-invite-form";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// Owner OpenPen management lane (29 October 2026).
//
// An invitation creates login access in one step, with an explicit role
// and location scope. The link is created here and shared by the owner;
// nothing is sent automatically, so the screen never claims delivery.
export default async function StaffInvitePage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.invite");
  const locations = await listLocationsAction();
  return (
    <OwnerPage>
      <Link
        href="/owner/staff/invitations"
        className="mb-4 inline-flex min-h-11 items-center gap-1 text-[13px] text-ink-3 hover:text-ink"
      >
        <ChevronLeft size={16} aria-hidden="true" />
        Invitations
      </Link>
      <PageHeader
        title={<>Invite staff</>}
        purpose={<>Choose a login role and an explicit location scope. Then copy the login
        link and share it yourself — nothing is sent automatically.</>}
      />

      <p className="mt-4 max-w-[700px] border-l-[3px] border-[var(--accent)] bg-deck px-4 py-3 text-[13px] text-ink-2">
        Scope is the locations this person can work in. Review the role and
        scope before creating access.
      </p>

      <div className="mt-5 max-w-[700px]">
        <StaffInviteForm locations={locations} />
      </div>

      <p className="mt-4 text-[12.5px] text-ink-3">
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
