import { listEnquiriesAction } from "@/lib/actions/enquiries";
import { listLocationsAction } from "@/lib/actions/people";
import { EnquiriesBoard } from "@/components/enquiries-board";
import { requireReception } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";

export default async function ReceptionEnquiriesPage() {
  const ctx = await requireReception();
  const [enquiries, locations] = await Promise.all([
    listEnquiriesAction({}),
    listLocationsAction(),
  ]);

  return (
    <StaffPage>
      <StaffPageHeader
        title="Enquiries"
        meta="Capture a walk-in, then follow it through."
      />
      <div className="mt-4">
        <EnquiriesBoard
          initialEnquiries={enquiries}
          detailHrefPrefix="/reception/enquiries"
          locations={locations}
          canWrite={hasPermission(ctx, "enquiries.write")}
        />
      </div>
    </StaffPage>
  );
}
