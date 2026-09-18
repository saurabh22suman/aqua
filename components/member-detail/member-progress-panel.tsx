import { ProgressPips } from "@/components/progress-pips";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDateIST } from "@/lib/time/tz";
import type {
  MemberProgress,
  MemberProgressFramework,
  MemberProgressNode,
} from "@/lib/services/skill-progress";

// V-11 — the progress view. Rendered on the coach member detail page
// and the owner member 360 Progress tab; the parent surface
// deliberately stays the zero-JS token link (owner decision
// 2026-09-18), so nothing here is exported to /p.
//
// Pips show the latest band per node; the line under each skill is the
// history over time (newest-first, capped at the last three so the
// panel stays scannable at 390×844).

function nodeLine(node: MemberProgressNode): string | null {
  if (!node.assessedAt) return null;
  const when = formatDateIST(node.assessedAt);
  return node.assessedByName
    ? `Last assessed ${when} · ${node.assessedByName}`
    : `Last assessed ${when}`;
}

function HistoryLine({ node }: { node: MemberProgressNode }) {
  if (!node.assessedAt) {
    return (
      <p className="mt-1 text-[12px] text-ink-3">
        Not assessed yet — tap a band on the assess screen.
      </p>
    );
  }
  const earlier = node.history.slice(1, 4);
  return (
    <div className="mt-1">
      <p className="text-[12px] text-ink-3">{nodeLine(node)}</p>
      {earlier.length > 0 ? (
        <p className="mt-0.5 text-[11px] text-ink-3">
          Before that:{" "}
          {earlier
            .map((h) => `${h.band} · ${formatDateIST(h.assessedAt)}`)
            .join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function FrameworkSection({ framework }: { framework: MemberProgressFramework }) {
  const levels = framework.nodes.filter((n) => n.parentId === null);
  const childrenOf = (levelId: string) =>
    framework.nodes.filter((n) => n.parentId === levelId);
  const loose = framework.nodes.filter(
    (n) => n.parentId !== null && !framework.nodes.some((p) => p.id === n.parentId),
  );

  return (
    <section className="mt-4 rounded-card border border-line bg-paper p-4">
      <h2 className="font-display text-[15px] font-semibold">
        {framework.name}
      </h2>
      <ul className="mt-3 divide-y divide-line">
        {levels.map((level) => (
          <li key={level.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[14px] font-medium">{level.name}</p>
              <ProgressPips band={level.band} label={level.name} size="sm" />
            </div>
            <ul className="mt-2 space-y-2.5">
              {childrenOf(level.id).map((skill) => (
                <li key={skill.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px]">{skill.name}</p>
                    <HistoryLine node={skill} />
                  </div>
                  <div className="flex-none pt-0.5">
                    <ProgressPips band={skill.band} label={skill.name} />
                  </div>
                </li>
              ))}
              {childrenOf(level.id).length === 0 ? (
                <li className="text-[12px] text-ink-3">No skills under this level yet.</li>
              ) : null}
            </ul>
          </li>
        ))}
        {loose.map((node) => (
          <li key={node.id} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[14px]">{node.name}</p>
              <ProgressPips band={node.band} label={node.name} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MemberProgressPanel({
  progress,
  emptyAction,
}: {
  progress: MemberProgress | null;
  emptyAction?: { label: string; href: string };
}) {
  const frameworks =
    progress?.frameworks.filter((f) => f.nodes.length > 0) ?? [];
  if (frameworks.length === 0) {
    return (
      <div className="mt-4 rounded-card border border-line bg-paper">
        <EmptyState
          title="No skill ladder yet"
          body="Assessments appear here once the academy has a skill ladder and a coach records the first band."
          action={emptyAction}
        />
      </div>
    );
  }

  return (
    <div>
      <p className="mt-4 text-[12.5px] text-ink-3">
        Latest band per skill, with the assessment history underneath.
        Four pips is the top band.
      </p>
      {frameworks.map((framework) => (
        <FrameworkSection key={framework.id} framework={framework} />
      ))}
    </div>
  );
}
