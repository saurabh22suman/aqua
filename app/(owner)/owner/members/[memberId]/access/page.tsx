import { notFound } from "next/navigation";
import { MemberEnrollmentForm } from "@/components/member-detail/member-enrollment-form";
import { hasPermission } from "@/lib/auth/permission";
import { isFacilityScopedRoleKey } from "@/lib/services/facility-scope";
import { MemberAccessPanel } from "@/components/member-detail/member-access-panel";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { requireUuidParam } from "@/lib/params";
import {
  readMemberAccessLinks,
  type MemberAccessRead,
} from "@/lib/services/member-link-readmodel";

// The page guards the surface and link-confirm permission. The read model
// rechecks live facility authority; enrollment also requires members.write.
export default async function MemberAccessPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "members.link.confirm");
  const { memberId } = await params;
  requireUuidParam(memberId);

  let read: MemberAccessRead | null = null;
  let failed = false;
  try {
    read = await readMemberAccessLinks(ctx, memberId);
  } catch {
    // A read that could not be made is not an empty list. The panel says
    // so and offers a retry.
    failed = true;
  }
  // A member that is missing and a member the actor may not see are the
  // same answer.
  if (!failed && read === null) notFound();

  return (
    <OwnerPage className="max-w-3xl">
      <BackLink href={`/owner/members/${memberId}`} label="Member details" />
      <PageHeader
        className="mt-2"
        title="Member and family access"
        purpose="Set up and manage sign-in links for this member and their guardians. Confirming says which account belongs to which person — it is not a check that anybody owns a phone. An invitation is handed over by hand; nothing is sent for you."
      />
      {read && hasPermission(ctx, "members.write") && (ctx.roleKey === "owner" || isFacilityScopedRoleKey(ctx.roleKey)) ? <MemberEnrollmentForm key={read.memberId} read={read} /> : null}
      <div className="mt-4">
        <MemberAccessPanel read={read} failed={failed} />
      </div>
    </OwnerPage>
  );
}
