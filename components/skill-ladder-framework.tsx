import type { SkillLadderRow } from "@/lib/services/skill-ladder";

// Owner Settings — the framework half of the canonical master/detail.
// Rows are ordinary buttons; the selected row is highlighted and the
// manager renders one contextual editor below/right. No second action is
// introduced here.

export type SkillSelection = { nodeId: string; kind: "level" | "skill" };

export function SkillFramework({
  ladders,
  selected,
  onSelect,
  canEdit,
}: {
  ladders: SkillLadderRow[];
  selected: SkillSelection | null;
  onSelect: (selection: SkillSelection) => void;
  canEdit: boolean;
}) {
  return (
<section className="min-w-0 lg:col-span-2" aria-label="Skill framework">
  <div className="rounded-card border border-line bg-paper p-4">
    <h2 className="font-display text-[16px] font-semibold">Framework</h2>
    <p className="mt-0.5 text-[12.5px] text-ink-3">
      Choose a level or skill to edit its detail.
    </p>
    {!canEdit ? (
      <p className="mt-2 rounded-ctl bg-deck px-3 py-2 text-[12.5px] text-ink-2">
        Read-only view. Curriculum editing is delegated to the academy&apos;s
        designated curriculum lead.
      </p>
    ) : null}
    <nav aria-label="Skill framework rows" className="mt-3">
      {ladders.map((ladder) => {
        const ladderLevels = ladder.nodes.filter((node) => node.parentId === null);
        return (
          <div key={ladder.id} className="mt-4 first:mt-0">
            <h3 className="font-display text-[14px] font-semibold">{ladder.name}</h3>
            <p className="mt-0.5 text-[11px] text-ink-3">
              Activity type: {ladder.activityTypeKey}
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {ladderLevels.map((level) => {
                const levelSkills = ladder.nodes
                  .filter((node) => node.parentId === level.id)
                  .sort((a, b) => a.ordinal - b.ordinal);
                return (
                  <li key={level.id}>
                    <button
                      type="button"
                      data-testid={`framework-level-${level.id}`}
                      aria-current={
                        selected?.nodeId === level.id ? "true" : undefined
                      }
                      onClick={() => onSelect({ nodeId: level.id, kind: "level" })}
                      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-ctl px-2.5 py-1.5 text-left text-[13.5px] motion-fast transition-colors ${
                        selected?.nodeId === level.id
                          ? "bg-[var(--action-soft)] font-medium text-[var(--action-ink)]"
                          : "text-ink-2 hover:bg-deck"
                      }`}
                    >
                      <span className="min-w-0 truncate">{level.name}</span>
                      <span className="flex-none text-[11px] text-ink-3">
                        {levelSkills.length} skill{levelSkills.length === 1 ? "" : "s"}
                      </span>
                    </button>
                    {levelSkills.length > 0 ? (
                      <ul className="ml-3 mt-0.5 space-y-0.5">
                        {levelSkills.map((skill) => (
                          <li key={skill.id}>
                            <button
                              type="button"
                              data-testid={`framework-skill-${skill.id}`}
                              aria-current={
                                selected?.nodeId === skill.id ? "true" : undefined
                              }
                              onClick={() =>
                                onSelect({ nodeId: skill.id, kind: "skill" })
                              }
                              className={`flex min-h-11 w-full items-center rounded-ctl px-2.5 py-1.5 text-left text-[13px] motion-fast transition-colors ${
                                selected?.nodeId === skill.id
                                  ? "bg-[var(--action-soft)] font-medium text-[var(--action-ink)]"
                                  : "text-ink-2 hover:bg-deck"
                              }`}
                            >
                              {skill.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  </div>
</section>
  );
}
