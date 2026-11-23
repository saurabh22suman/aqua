import Link from "next/link";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import type { WorkspaceRoleOptions } from "@/lib/auth/workspace-roles";

export function WorkspaceRoleSwitch({
  options, settingsHref, className = "",
}: {
  options: WorkspaceRoleOptions | null | undefined;
  settingsHref: string;
  className?: string;
}) {
  if (options === undefined) return (
    <div className={`flex flex-wrap items-center gap-x-3 text-sm text-ink-2 ${className}`}>
      <p role="status">Couldn’t load your roles.</p>
      <a href={settingsHref} className="inline-flex min-h-11 items-center text-[var(--accent-ink)] underline underline-offset-2">Retry</a>
    </div>
  );
  if (!options?.choices.length) return null;
  return (
    <details className={`group rounded-ctl border border-line bg-paper ${className}`}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 marker:content-none">
        <span className="text-sm font-semibold text-ink">Switch role</span>
        <span className="flex items-center gap-2 text-[12px] text-ink-2">
          Current role · {options.current}
          <ChevronDown size={16} className="shrink-0 group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {options.choices.map(choice => (
          <li key={choice.href}>
            <Link href={choice.href} prefetch={false} className="flex min-h-11 items-center gap-3 px-4 py-2.5 hover:bg-deck">
              <span className="min-w-0 flex-1 break-words">
                <span className="block text-sm font-medium text-ink">{choice.label}</span>
                <span className="block text-[12px] text-ink-2">{choice.detail}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
