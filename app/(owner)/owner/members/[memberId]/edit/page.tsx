import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getMemberDetailAction, listLocationsAction } from "@/lib/actions/people";
import { MemberEditForm } from "@/components/member-edit-form";
import { MemberPageLoading } from "@/components/member-detail/member-page-loading";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { requireUuidParam } from "@/lib/params";
import { resolveFacilityValue } from "@/lib/facility";

// The edit page owns its loading state now. The nearest segment boundary
// (`members/loading.tsx`) was relocated into the pages (one boundary variable;
// see MEMBERS-BOUNDARY-CANDIDATE.md).
//
// The member read and the missing/foreign-member check stay BEFORE the
// boundary on purpose: a missing member must be a 404, never a skeleton. That
// leaves nothing on this page to stream, so the boundary exists to keep the
// route's own honest fallback (rather than the HOME skeleton from
// `owner/loading.tsx`) after the segment boundary was removed.
export default async function EditMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "members.write");
  const { memberId } = await params;
  requireUuidParam(memberId);
  const sp = searchParams ? await searchParams : {};
  const facilityParam = typeof sp.facility === "string" ? sp.facility : undefined;
  const [member, locations] = await Promise.all([
    getMemberDetailAction(memberId),
    listLocationsAction(),
  ]);
  if (!member) notFound();

  // The scope the profile was opened under — the canonical facility from
  // the URL, or an explicit "all" — travels with every way back, so the
  // edit round-trip never lands on a URL without the query (which the
  // facility switcher would normalise with a hard reload).
  const facilityScope = resolveFacilityValue(facilityParam, undefined) ?? "all";
  const profileHref = `/owner/members/${member.memberId}?facility=${facilityScope}`;
  // The exact URL this edit is being rendered at, so a changed destination
  // never inherits a previous profile entry intent.
  const editQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string" && value) editQuery.set(key, value);
  }
  const editHref = `/owner/members/${member.memberId}/edit${editQuery.size ? `?${editQuery}` : ""}`;

  return (
    <OwnerPage className="max-w-3xl">
      <BackLink href={profileHref} label="Member details" />
      <PageHeader
        className="mt-2"
        title="Edit member details"
        purpose={`${member.fullName} · ${member.memberCode} · ${member.locationName}`}
      />
      <Suspense fallback={<MemberPageLoading variant="edit" />}>
        <EditMemberCard
          member={member}
          locations={locations}
          returnHref={profileHref}
          originIntent={{
            namespace: `${ctx.tenantId}:${ctx.userId}`,
            memberId: member.memberId,
            facility: facilityScope,
            editHref,
          }}
        />
      </Suspense>
    </OwnerPage>
  );
}

function EditMemberCard({
  member,
  locations,
  returnHref,
  originIntent,
}: {
  member: NonNullable<Awaited<ReturnType<typeof getMemberDetailAction>>>;
  locations: Awaited<ReturnType<typeof listLocationsAction>>;
  returnHref: string;
  originIntent: {
    namespace: string;
    memberId: string;
    facility: string;
    editHref: string;
  };
}) {
  return (
    <div className="mt-4 rounded-card border border-line bg-paper p-4">
      <MemberEditForm
        member={member}
        locations={locations}
        returnHref={returnHref}
        originIntent={originIntent}
      />
    </div>
  );
}
