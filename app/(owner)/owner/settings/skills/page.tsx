import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { listSkillLaddersAction } from "@/lib/actions/skill-ladder";
import { SkillLadderManager } from "@/components/skill-ladder-manager";
import { EmptyState } from "@/components/ui/EmptyState";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";

// V-09 — owner skill-ladder settings. The list is the generic
// framework the bridge populated from the preset ladder; editing a
// level/skill name or a rubric band audits one row and never touches
// the preset-shaped skill_levels/skills tables.
//
// R02 (2026-10-13 role-workflow audit) — viewing the ladder needs
// levels.read; editing needs levels.write, the delegated curriculum
// capability. Owner/admin hold it via their full grant set; the
// designated Curriculum Lead edits from the same framework through
// its own delegated role; the ladder is read-only otherwise.
//
// The swim.levels feature gates the surface: a tenant without the
// module gets the honest "not enabled" state instead of a 403 from
// the levels.read action.

export default async function OwnerSkillsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  const enabled = hasFeature(ctx, "swim.levels");
  const ladders = enabled ? await listSkillLaddersAction() : [];
  const canEdit = hasPermission(ctx, "levels.write");

  return (
    <OwnerPage workflow="settings" className="max-w-2xl">
      <BackLink href="/owner/settings" label="Settings" />
      <PageHeader
        title={<>Skill ladder</>}
        purpose={<>The levels and skills coaches assess against, with the four-band
        rubric.</>}
      />
      {enabled ? (
        <SkillLadderManager ladders={ladders} canEdit={canEdit} />
      ) : (
        <div className="mt-4 rounded-card border border-line bg-paper">
          <EmptyState
            title="Skill ladders aren't enabled"
            body="This academy's plan doesn't include the skill-level module, so there is no ladder to edit."
          />
        </div>
      )}
    </OwnerPage>
  );
}
