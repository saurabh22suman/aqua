import { notFound } from "next/navigation";
import { getEnquiryDetailAction } from "@/lib/actions/enquiries";
import { listLocationsAction } from "@/lib/actions/people";
import { listBatchesAction } from "@/lib/actions/programs";
import { EnquiryDetailView } from "@/components/enquiry-detail-view";

export default async function ReceptionEnquiryDetailPage({
  params,
}: {
  params: Promise<{ enquiryId: string }>;
}) {
  const { enquiryId } = await params;
  const [enquiry, locations, batches] = await Promise.all([
    getEnquiryDetailAction(enquiryId),
    listLocationsAction(),
    listBatchesAction(),
  ]);
  if (!enquiry) notFound();

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[19px] font-semibold">{enquiry.fullName}</h1>
      <p className="mt-0.5 text-[12.5px] text-ink-3">
        {enquiry.source}
        {enquiry.phone ? ` · ${enquiry.phone}` : ""}
      </p>
      <div className="mt-4">
        <EnquiryDetailView enquiry={enquiry} locations={locations} batches={batches} />
      </div>
    </main>
  );
}