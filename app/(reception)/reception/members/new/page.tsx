import { listLocationsAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { MemberCreateForm } from "@/components/member-create-form";
import { requireReception } from "@/lib/auth/surface-guard";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";

export default async function ReceptionNewMemberPage() {
  await requireReception();
  const [locations, terminology] = await Promise.all([
    listLocationsAction(),
    // L3 audit — the page heading and the form's guardian copy
    // both route through the closed-key resolver.
    getTerminologyAction(),
  ]);

  return (
    <StaffPage>
      <StaffPageHeader title={`Add ${resolveTerm(terminology, "member", 1)}`} />
      <div className="mt-4">
        <MemberCreateForm
          locations={locations}
          memberDetailBasePath="/reception/members"
          terminology={terminology}
        />
      </div>
    </StaffPage>
  );
}
