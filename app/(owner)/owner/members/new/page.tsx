import { listLocationsAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { DEFAULT_TERMS } from "@/lib/terminology/keys";
import { MemberCreateForm } from "@/components/member-create-form";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { cookies } from "next/headers";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";

export default async function NewMemberPage({ searchParams }: { searchParams?: Promise<{ facility?: string }> }) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "members.write");
  const [locations, terminology] = await Promise.all([
    listLocationsAction(),
    // L3 audit — the page heading and the form's guardian copy
    // both route through the closed-key resolver.
    getTerminologyAction(),
  ]);
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const selected = params.facility === "all"
    ? undefined
    : resolveFacilityValue(params.facility, cookieStore.get(FACILITY_COOKIE)?.value);
  const initialLocationId = selected ? locations.find((location) => location.id === selected)?.id ?? "" : undefined;
  const membersHref = initialLocationId ? `/owner/members?facility=${initialLocationId}` : "/owner/members";

  return (
    <OwnerPage className="max-w-3xl">
      <BackLink href={membersHref} label="Members" />
      <PageHeader
        className="mt-2"
        title={`Add ${DEFAULT_TERMS[terminology.locale].member.one}`}
      />
      <div className="mt-4 rounded-card border border-line bg-paper p-4">
        <MemberCreateForm locations={locations} terminology={terminology} initialLocationId={initialLocationId} cancelHref={membersHref} />
      </div>
    </OwnerPage>
  );
}
