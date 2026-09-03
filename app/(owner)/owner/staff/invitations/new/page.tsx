import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listLocationsAction } from "@/lib/actions/people";
import { StaffInviteForm } from "@/components/staff-invite-form";

// Phase 3.6 — staff invite form. Phone + role + location
// scope. Locations are read once on the server to render the
// scope picker; the service re-validates any locationId on
// submit.
export default async function StaffInvitePage() {
  const locations = await listLocationsAction();
  return (
    <main className="px-5 pt-6 pb-8">
      <Link
        href="/owner/staff/invitations"
        className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink mb-4"
      >
        <ChevronLeft size={16} />
        Invitations
      </Link>
      <h1 className="font-display text-[19px] font-semibold">Invite staff</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Add the person to the directory first, then invite them to log in from the staff invitations surface.
      </p>

      <div className="mt-6">
        <StaffInviteForm locations={locations} />
      </div>
    </main>
  );
}
