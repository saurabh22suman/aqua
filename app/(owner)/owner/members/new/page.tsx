import { listLocationsAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { MemberCreateForm } from "@/components/member-create-form";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";

export default async function NewMemberPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "members.write");
  const [locations, terminology] = await Promise.all([
    listLocationsAction(),
    // L3 audit — the page heading and the form's guardian copy
    // both route through the closed-key resolver.
    getTerminologyAction(),
  ]);

  return (
    <OwnerPage className="max-w-3xl">
      <BackLink href="/owner/members" label="Members" />
      <PageHeader
        className="mt-2"
        title={`Add ${resolveTerm(terminology, "member", 1)}`}
        purpose="Personal details, guardian and consent in one bounded form."
      />
      <div className="mt-4 rounded-card border border-line bg-paper p-4">
        <MemberCreateForm locations={locations} terminology={terminology} />
      </div>
    </OwnerPage>
  );
}
