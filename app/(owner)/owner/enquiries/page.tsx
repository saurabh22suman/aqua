import { listEnquiriesAction } from "@/lib/actions/enquiries";
import { listLocationsAction } from "@/lib/actions/people";
import { EnquiriesBoard } from "@/components/enquiries-board";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";

export default async function EnquiriesPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "enquiries.read");
  const [enquiries, locations] = await Promise.all([
    listEnquiriesAction({}),
    listLocationsAction(),
  ]);

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[19px] font-semibold">Enquiries</h1>
      <div className="mt-4">
        <EnquiriesBoard
          initialEnquiries={enquiries}
          locations={locations}
          canWrite={hasPermission(ctx, "enquiries.write")}
        />
      </div>
    </main>
  );
}
