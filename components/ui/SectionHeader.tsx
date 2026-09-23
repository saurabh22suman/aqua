import type { ReactNode } from "react";

// PR3-C2 — section header. One heading shape for every screen, with an
// optional trailing element (count chip, link) so headers stop being
// re-styled per file.
export function SectionHeader({
  title,
  subtitle,
  trailing,
  className = "",
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="font-display text-[15px] font-semibold">{title}</h2>
        {subtitle ? (
          <p className="text-[12.5px] text-ink-3 mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      {trailing ? <div className="flex-none">{trailing}</div> : null}
    </div>
  );
}
