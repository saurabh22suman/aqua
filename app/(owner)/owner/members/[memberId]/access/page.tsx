import { notFound } from "next/navigation";
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

// THE OWNER'S ACCESS PAGE FOR ONE MEMBER.
//
// WHAT IT IS: the place where staff hand a member or a guardian their own
// sign-in link, and where the club stands behind a pairing.
//
// WHAT IT IS NOT: an account screen. It never provisions a link, never
// searches club accounts, never creates a person and never invites anyone
// by message. A link row is the thing this page manages, and a link row
// exists only after a club account has been enrolled and named.
//
// A CONFIRMATION IS ABOUT THE PAIRING, NOT ABOUT A PHONE. The card shows
// which account is being confirmed and which number the club has on file
// for the person; the two may differ and the page never compares them.
//
// THE PAGE READ IS AUTHORIZED HERE, NOT IN THE LAYOUT. The page guard
// (requireOwner) proves the surface, requirePagePermission proves the
// grant, and the read model then proves the actor's REAL authority — the
// live membership, the grant it carries and the facilities it is currently
// assigned to — against the member's own facility. A member outside that
// facility answers 404, exactly like a member who does not exist.
//
// THE READ IS A SERVICE CALL, NOT A NEW SERVER ACTION. The page already
// holds the actor's context and has already checked the grant; the read
// model re-checks the authority from the database. This keeps the slice
// clear of lib/auth/**, which is a protected path.
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
        purpose="The sign-in links this member and their guardians already have. Confirming says which account belongs to which person — it is not a check that anybody owns a phone. An invitation is handed over by hand; nothing is sent for you."
      />
      <div className="mt-4">
        <MemberAccessPanel read={read} failed={failed} />
      </div>
    </OwnerPage>
  );
}
