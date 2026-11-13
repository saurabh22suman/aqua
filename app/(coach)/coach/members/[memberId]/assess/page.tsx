import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { getMemberProgressAction } from "@/lib/actions/assessments";
import { AssessmentBoard } from "@/components/assessment-board";
import { EmptyState } from "@/components/ui/EmptyState";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";
import { isUuid, requireUuidParam } from "@/lib/params";

// V-10 — coach assessment entry. Reached from the register row (with
// the session id, so the back link returns to the register) and from
// the coach member page. One tap per node band; history sits under the
// board on the member page (V-11).
//
// The swim.levels feature gates the whole surface: a tenant without
// the module sees an honest "not enabled" state rather than a 403 from
// the action. The action still enforces levels.read/levels.assess.

export default async function AssessMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams?: Promise<{ sessionId?: string }>;
}) {
  const ctx = await requireCoach();
  const { memberId } = await params;
  requireUuidParam(memberId);
  const sp = searchParams ? await searchParams : {};
  const sessionId =
    sp.sessionId && isUuid(sp.sessionId) ? sp.sessionId : null;

  if (!hasFeature(ctx, "swim.levels")) {
    return (
      <StaffPage>
        <StaffPageHeader title="Assessment" />
        <div className="mt-5">
          <EmptyState
            title="Skill assessments aren't enabled"
            body="This academy's plan doesn't include the skill ladder. The owner can turn it on from settings."
            action={{ label: "Back to today", href: "/coach" }}
          />
        </div>
      </StaffPage>
    );
  }

  const progress = await getMemberProgressAction(memberId);
  if (!progress) notFound();

  // AssessmentBoard's empty-ladder state renders no heading of its own;
  // give the page the h1 in that state, and let the board own its h1
  // when a ladder exists (one heading, never two).
  const hasLadder = progress.frameworks.some((f) => f.nodes.length > 0);

  const canAssess = hasPermission(ctx, "levels.assess");
  const back = sessionId
    ? { href: `/coach/register/${sessionId}`, label: "Register" }
    : { href: `/coach/members/${memberId}`, label: "Member" };

  return (
    <StaffPage>
      {hasLadder ? null : (
        <StaffPageHeader
          title={`Assess ${progress.memberName}`}
          meta={progress.memberCode}
        />
      )}
      <AssessmentBoard
        memberId={memberId}
        progress={progress}
        canAssess={canAssess}
        back={back}
      />
      <p className="mt-4 text-[12px] text-ink-3">
        <Link
          href={`/coach/members/${memberId}`}
          className="underline underline-offset-2"
        >
          View this member&apos;s progress history
        </Link>
      </p>
    </StaffPage>
  );
}
