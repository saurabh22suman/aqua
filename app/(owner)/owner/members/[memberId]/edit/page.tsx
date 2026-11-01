import { notFound } from "next/navigation";
import { getMemberDetailAction, listLocationsAction } from "@/lib/actions/people";
import { MemberEditForm } from "@/components/member-edit-form";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { requireUuidParam } from "@/lib/params";

export default async function EditMemberPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "members.write");
  const { memberId } = await params;
  requireUuidParam(memberId);
  const [member, locations] = await Promise.all([
    getMemberDetailAction(memberId),
    listLocationsAction(),
  ]);
  if (!member) notFound();

  return (
    <OwnerPage className="max-w-3xl">
      <BackLink href={`/owner/members/${member.memberId}`} label="Member details" />
      <PageHeader
        className="mt-2"
        title="Edit member details"
        purpose={`${member.fullName} · ${member.memberCode} · ${member.locationName}`}
      />
      <div className="mt-4 rounded-card border border-line bg-paper p-4">
        <MemberEditForm member={member} locations={locations} />
      </div>
    </OwnerPage>
  );
}
