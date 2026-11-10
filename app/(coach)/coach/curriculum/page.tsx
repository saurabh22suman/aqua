import { requireCoach } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { listSkillLaddersAction } from "@/lib/actions/skill-ladder";
import { SkillLadderManager } from "@/components/skill-ladder-manager";
import { EmptyState } from "@/components/ui/EmptyState";
import { BackLink } from "@/components/ui/BackLink";
import {
  STAFF_CARD,
  StaffPage,
  StaffPageHeader,
} from "@/components/staff-ui/staff-page";

// R02 (2026-10-13 role-workflow audit) — the delegated curriculum
// maintainer's editing surface. It lives on the coach surface because
// the Curriculum Lead role is coach-scoped; an ordinary coach who
// reaches it sees the framework read-only (levels.read), while the
// designated lead (levels.write) can edit. The owner keeps the same
// editor in Settings → Skills and controls the designation on the
// staff page.
//
// Scope statement: the framework is academy-wide; this page does not
// imply per-activity isolation.
export default async function CoachCurriculumPage() {
  const ctx = await requireCoach();
  const enabled = hasFeature(ctx, "swim.levels") && hasPermission(ctx, "levels.read");
  const ladders = enabled ? await listSkillLaddersAction() : [];
  const canEdit = hasPermission(ctx, "levels.write");

  return (
    <StaffPage>
      <BackLink href="/coach/me" label="Me" />
      <StaffPageHeader
        title="Curriculum"
        meta={
          canEdit
            ? "The levels and skills coaches assess against, with the four-band rubric. Changes are saved to the academy-wide framework and audited."
            : "The levels and skills coaches assess against, with the four-band rubric. Ask the owner if you should maintain the curriculum."
        }
      />

      {enabled ? (
        <SkillLadderManager ladders={ladders} canEdit={canEdit} />
      ) : (
        <div className={`mt-4 ${STAFF_CARD}`}>
          <EmptyState
            title="Skill ladders aren't enabled"
            body="This academy's plan doesn't include the skill-level module, so there is no ladder to view."
          />
        </div>
      )}
    </StaffPage>
  );
}
