import { listEnquiriesAction } from "@/lib/actions/enquiries";
import { listLocationsAction } from "@/lib/actions/people";
import { EnquiriesBoard } from "@/components/enquiries-board";
import { requireReception } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { EnquiriesRetry } from "@/components/enquiries-retry";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";

export default async function ReceptionEnquiriesPage() {
  const ctx = await requireReception();
  const [enquiries, locations] = await Promise.all([
    listEnquiriesAction({}).catch(() => null),
    listLocationsAction().catch(() => null),
  ]);

  return (
    <StaffPage>
      <StaffPageHeader
        title="Enquiries"
        meta="Save a new enquiry or find a conversation already in progress."
      />
      <div className="mt-4">
        {enquiries === null || locations === null ? (
          <section className="space-y-2 rounded-card border border-line bg-paper p-4">
            <p role="alert" className="text-sm">Could not load enquiries.</p>
            <EnquiriesRetry />
          </section>
        ) : <EnquiriesBoard
          initialEnquiries={enquiries}
          detailHrefPrefix="/reception/enquiries"
          locations={locations}
          navigationNamespace={`${ctx.tenantId}:${ctx.userId}:reception`}
          canWrite={hasPermission(ctx, "enquiries.write")}
        />}
      </div>
    </StaffPage>
  );
}
