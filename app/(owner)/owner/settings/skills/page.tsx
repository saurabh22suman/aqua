import Link from "next/link";
import { requireOwner } from "@/lib/auth/surface-guard";
import { hasFeature } from "@/lib/auth/permission";
import { listSkillLaddersAction } from "@/lib/actions/skill-ladder";
import { SkillLadderManager } from "@/components/skill-ladder-manager";
import { EmptyState } from "@/components/ui/EmptyState";

// V-09 — owner skill-ladder settings. The list is the generic
// framework the bridge populated from the preset ladder; editing a
// level/skill name or a rubric band audits one row and never touches
// the preset-shaped skill_levels/skills tables.
//
// The swim.levels feature gates the surface: a tenant without the
// module gets the honest "not enabled" state instead of a 403 from
// the levels.read action.

export default async function OwnerSkillsPage() {
  const ctx = await requireOwner();
  const enabled = hasFeature(ctx, "swim.levels");
  const ladders = enabled ? await listSkillLaddersAction() : [];

  return (
    <main className="px-5 pt-6 pb-8 max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link
          href="/owner/settings"
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          Settings
        </Link>
        {" / "}
        skills
      </p>
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        Skill ladder
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        The levels and skills coaches assess against, with the four-band
        rubric. Changes are saved to the generic framework and audited;
        the preset&apos;s own ladder stays as seeded.
      </p>
      {enabled ? (
        <SkillLadderManager ladders={ladders} />
      ) : (
        <div className="mt-4 rounded-card border border-line bg-paper">
          <EmptyState
            title="Skill ladders aren't enabled"
            body="This academy's plan doesn't include the skill-level module, so there is no ladder to edit."
          />
        </div>
      )}
    </main>
  );
}
