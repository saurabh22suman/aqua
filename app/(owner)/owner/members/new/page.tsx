import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { listLocationsAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { MemberCreateForm } from "@/components/member-create-form";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { buttonClasses } from "@/components/ui/Button";
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
    getTerminologyAction().then(ownerTerminology),
  ]);
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const selected = params.facility === "all"
    ? undefined
    : resolveFacilityValue(params.facility, cookieStore.get(FACILITY_COOKIE)?.value);
  const initialLocationId = selected ? locations.find((location) => location.id === selected)?.id ?? "" : undefined;
  const membersHref = initialLocationId ? `/owner/members?facility=${initialLocationId}` : "/owner/members";

  return (
    <OwnerPage workflow="edit" className="max-w-3xl">
      <BackLink href={membersHref} label={titleCase(resolveTerm(terminology, "member", "other"))} />
      <PageHeader
        className="mt-2"
        title={`Add ${resolveTerm(terminology, "member", 1)}`}
        purpose={`Record name, date of birth, contact and consent. After saving, enrol the ${resolveTerm(terminology, "member", 1)} in a ${resolveTerm(terminology, "batch", 1)} from their profile.`}
        action={
          <Link
            href="/owner/members/import"
            className={buttonClasses({ variant: "secondary", size: "md" })}
          >
            Import a list
          </Link>
        }
      />
      <div className="mt-4 rounded-card border border-line bg-paper p-4">
        <MemberCreateForm locations={locations} terminology={terminology} initialLocationId={initialLocationId} cancelHref={membersHref} />
      </div>
    </OwnerPage>
  );
}
