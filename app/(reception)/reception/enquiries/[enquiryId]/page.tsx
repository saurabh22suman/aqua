import { notFound } from "next/navigation";
import { getEnquiryDetailAction } from "@/lib/actions/enquiries";
import { listLocationsAction } from "@/lib/actions/people";
import { listBatchesAction } from "@/lib/actions/programs";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { EnquiryDetailView } from "@/components/enquiry-detail-view";
import { requireReception } from "@/lib/auth/surface-guard";
import { BackLink } from "@/components/ui/BackLink";
import { PersonAvatar } from "@/components/avatar";
import { requireUuidParam } from "@/lib/params";
import { formatPhoneIN } from "@/lib/phone";
import { StaffPage } from "@/components/staff-ui/staff-page";

export default async function ReceptionEnquiryDetailPage({
  params,
}: {
  params: Promise<{ enquiryId: string }>;
}) {
  await requireReception();
  const { enquiryId } = await params;
  requireUuidParam(enquiryId);
  const [enquiry, locations, batches, terminology] = await Promise.all([
    getEnquiryDetailAction(enquiryId),
    listLocationsAction(),
    listBatchesAction(),
    // L3 audit — see owner-side page for the rationale.
    getTerminologyAction(),
  ]);
  if (!enquiry) notFound();

  return (
    <StaffPage>
      <BackLink href="/reception/enquiries" label="Enquiries" />
      <div className="flex items-start gap-3">
        <PersonAvatar name={enquiry.fullName} size={44} className="flex-none" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-medium leading-tight tracking-[-0.01em] text-ink">
            {enquiry.fullName}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {enquiry.source}
            {enquiry.phone ? ` · ${formatPhoneIN(enquiry.phone)}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <EnquiryDetailView
          enquiry={enquiry}
          locations={locations}
          batches={batches}
          memberDetailBasePath="/reception/members"
          terminology={terminology}
        />
      </div>
    </StaffPage>
  );
}
