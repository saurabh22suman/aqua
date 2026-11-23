import { requireCoach } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { listSkillLaddersAction } from "@/lib/actions/skill-ladder";
import { SkillLadderManager } from "@/components/skill-ladder-manager";
import { EmptyState } from "@/components/ui/EmptyState";
import { BackLink } from "@/components/ui/BackLink";
import { buttonClasses } from "@/components/ui/Button";
import type { SkillLadderRow } from "@/lib/services/skill-ladder";
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
//
// finish/staff — a failed framework read is its own state. It used to
// throw to the global error boundary; the page now says the curriculum
// is unavailable and retries in place, without pretending the academy
// has no ladder.
export default async function CoachCurriculumPage() {
  const ctx = await requireCoach();
  const enabled = hasFeature(ctx, "swim.levels") && hasPermission(ctx, "levels.read");
  let ladders: SkillLadderRow[] | null = [];
  if (enabled) {
    ladders = await listSkillLaddersAction().catch(() => null);
  }
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

      {!enabled ? (
        <div className={`mt-4 ${STAFF_CARD}`}>
          <EmptyState
            title="Skill ladders aren't enabled"
            body="This academy's plan doesn't include the skill-level module, so there is no ladder to view."
          />
        </div>
      ) : ladders === null ? (
        <section
          aria-labelledby="curriculum-unavailable"
          className={`mt-4 p-4 ${STAFF_CARD}`}
          data-testid="curriculum-unavailable"
        >
          <h2
            id="curriculum-unavailable"
            className="text-[15px] font-medium text-ink"
          >
            Curriculum unavailable
          </h2>
          <p role="alert" className="mt-1 text-[13px] leading-snug text-ink-2">
            Could not load the curriculum. No changes were made.
          </p>
          <a
            href="/coach/curriculum"
            className={buttonClasses({
              variant: "secondary",
              size: "sm",
              className: "mt-3",
            })}
          >
            Retry curriculum
          </a>
        </section>
      ) : (
        <SkillLadderManager ladders={ladders} canEdit={canEdit} />
      )}
    </StaffPage>
  );
}
