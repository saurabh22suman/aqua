import { listEnquiriesAction } from "@/lib/actions/enquiries";
import { EnquiriesBoard } from "@/components/enquiries-board";

export default async function EnquiriesPage() {
  const enquiries = await listEnquiriesAction({});

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[19px] font-semibold">Enquiries</h1>
      <div className="mt-4">
        <EnquiriesBoard initialEnquiries={enquiries} />
      </div>
    </main>
  );
}
