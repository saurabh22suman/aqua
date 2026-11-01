import Link from "next/link";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import { StaffCreateForm } from "@/components/staff-create-form";
import { searchStaffCandidatesAction } from "@/lib/actions/staff";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// Owner OpenPen management lane (29 October 2026).
//
// Add vs. invite are two surfaces for two intents: this page adds a
// staff record with no login (e.g. a worker paid in cash who does not
// need app access). The invitations surface sends a phone-OTP invite;
// if the user is new, the invite creates both the directory entry and
// the login in one step. The notice below states that split before the
// form, so a directory record is never read as a login grant.
export default async function StaffCreatePage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.write");
  // L3 audit — the staff-type option labelled "Coach" routes
  // through the closed-key `coach` resolver so a gym / multi-sport
  // tenant renders "Trainer", a dance / martial-arts tenant
  // renders "Instructor".
  const terminology = await getTerminologyAction();
  return (
    <OwnerPage>
      <Link
        href="/owner/staff"
        className="mb-4 inline-flex min-h-11 items-center gap-1 text-[13px] text-ink-3 hover:text-ink"
      >
        <ChevronLeft size={16} aria-hidden="true" />
        Staff
      </Link>
      <PageHeader
        title={<>Add staff record</>}
        purpose={<>Creates a directory record for someone who works here. It does not
        create a login.</>}
      />

      <div className="mt-4 max-w-[700px] border-l-[3px] border-[var(--accent)] bg-deck px-4 py-3 text-[13px] text-ink-2">
        Login access is managed separately through{" "}
        <Link
          href="/owner/staff/invitations"
          className="font-medium text-[var(--accent-ink)] underline underline-offset-2"
        >
          Invitations
        </Link>
        .
      </div>

      <div className="mt-5 max-w-[700px]">
        <StaffCreateForm
          terminology={terminology}
          searchCandidates={searchStaffCandidatesAction}
        />
      </div>
    </OwnerPage>
  );
}
