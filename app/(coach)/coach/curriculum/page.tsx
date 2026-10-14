import Link from "next/link";
import { BookOpen } from "lucide-react";
import { requireCoach } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { listSkillLaddersAction } from "@/lib/actions/skill-ladder";
import { SkillLadderManager } from "@/components/skill-ladder-manager";
import { EmptyState } from "@/components/ui/EmptyState";
import { BackLink } from "@/components/ui/BackLink";

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
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/coach/me" label="Me" />
      <h1 className="mt-2 flex items-center gap-2 font-display text-[19px] font-semibold">
        <BookOpen size={18} className="text-ink-2" aria-hidden="true" />
        Curriculum
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        The levels and skills coaches assess against, with the four-band
        rubric.{" "}
        {canEdit
          ? "Changes are saved to the academy-wide framework and audited."
          : "The owner can delegate editing to one curriculum lead."}
      </p>

      {enabled ? (
        <SkillLadderManager ladders={ladders} canEdit={canEdit} />
      ) : (
        <div className="mt-4 rounded-card border border-line bg-paper">
          <EmptyState
            title="Skill ladders aren't enabled"
            body="This academy's plan doesn't include the skill-level module, so there is no ladder to view."
          />
        </div>
      )}

      {!canEdit ? (
        <p className="mt-4 text-[12.5px] text-ink-3">
          Read-only. Ask the owner if you should maintain the curriculum.
        </p>
      ) : null}

      <div className="mt-6">
        <Link
          href="/coach/me"
          className="text-[13px] text-ink-3 underline underline-offset-2"
        >
          Back to Me
        </Link>
      </div>
    </main>
  );
}
