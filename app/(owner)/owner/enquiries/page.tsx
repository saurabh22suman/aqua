import { listEnquiriesAction } from "@/lib/actions/enquiries";
import { listLocationsAction } from "@/lib/actions/people";
import { EnquiriesBoard } from "@/components/enquiries-board";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function EnquiriesPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "enquiries.read");
  const [enquiries, locations] = await Promise.all([
    listEnquiriesAction({}),
    listLocationsAction(),
  ]);

  return (
    <OwnerPage>
      <PageHeader
        title="Enquiries"
        purpose="Reception handles the day-to-day follow-ups. Review where each current enquiry stands, then open one to continue the conversation."
      />
      <div className="mt-5">
        <EnquiriesBoard
          initialEnquiries={enquiries}
          locations={locations}
          canWrite={hasPermission(ctx, "enquiries.write")}
          variant="oversight"
        />
      </div>
    </OwnerPage>
  );
}
