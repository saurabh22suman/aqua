import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { hasPermission } from "@/lib/auth/permission";
import { notFound } from "next/navigation";
import { getEnquiryDetailAction } from "@/lib/actions/enquiries";
import { listLocationsAction } from "@/lib/actions/people";
import { listBatchesAction } from "@/lib/actions/programs";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { EnquiryDetailView } from "@/components/enquiry-detail-view";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { BackLink } from "@/components/ui/BackLink";
import { requireUuidParam } from "@/lib/params";
import { OwnerSectionLinks } from "@/components/owner-ui/owner-section-links";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatPhoneIN } from "@/lib/phone";
import { OwnerPage } from "@/components/owner-ui/owner-page";

export default async function EnquiryDetailPage({
  params,
}: {
  params: Promise<{ enquiryId: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "enquiries.read");
  const { enquiryId } = await params;
  requireUuidParam(enquiryId);
  const [enquiry, locations, batches, terminology] = await Promise.all([
    getEnquiryDetailAction(enquiryId),
    listLocationsAction(),
    listBatchesAction(),
    // L3 audit — EnquiryDetailView → EnquiryNewMemberFields uses
    // closed-key `guardian` for the "Guardian required — this is
    // a minor" copy.
    getTerminologyAction().then(ownerTerminology),
  ]);
  if (!enquiry) notFound();

  return (
    <OwnerPage workflow="record">
      <BackLink href="/owner/enquiries" label="Enquiries" />
      <PageHeader title={enquiry.fullName}
        purpose={<>{enquiry.source}{enquiry.phone ? <> · <a className="underline underline-offset-2" href={`tel:${enquiry.phone}`}>{formatPhoneIN(enquiry.phone)}</a></> : null}</>} />
      <OwnerSectionLinks label="Enquiry sections" className="mt-3" sections={[
        { id: "next-action-heading", label: "Next action" },
        { id: "follow-up-timeline-heading", label: "Follow-ups" },
        ...(enquiry.notes ? [{ id: "enquiry-notes-heading", label: "Notes" }] : []),
      ]} />
      <div className="mt-4">
        <EnquiryDetailView
          enquiry={enquiry}
          locations={locations}
          batches={batches}
          canWrite={hasPermission(ctx, "enquiries.write")}
          canOpenMember={hasPermission(ctx, "members.read")}
          terminology={terminology}
        />
      </div>
    </OwnerPage>
  );
}
