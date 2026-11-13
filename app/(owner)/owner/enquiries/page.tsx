import { listEnquiriesAction, listOverdueFollowUpsAction } from "@/lib/actions/enquiries";
import { listLocationsAction } from "@/lib/actions/people";
import { EnquiriesBoard } from "@/components/enquiries-board";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function EnquiriesPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "enquiries.read");
  const [enquiries, locations, overdueFollowUps] = await Promise.all([
    listEnquiriesAction({}),
    listLocationsAction(),
    listOverdueFollowUpsAction(),
  ]);

  return (
    <OwnerPage>
      <PageHeader
        title="Enquiries"
        purpose="Review enquiries and continue the conversation."
      />
      <div className="mt-5">
        <EnquiriesBoard
          initialEnquiries={enquiries}
          locations={locations}
          overdueFollowUps={overdueFollowUps}
          navigationNamespace={`${ctx.tenantId}:${ctx.userId}`}
          canWrite={hasPermission(ctx, "enquiries.write")}
          variant="oversight"
        />
      </div>
    </OwnerPage>
  );
}
