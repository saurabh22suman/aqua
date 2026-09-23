import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

// PR3-C2 — attention row. DESIGN.md: an attention item states a reason
// and is actionable; an inert row must not advertise itself as
// tappable. Same card shape either way, chevron only when linked.
export function AttentionRow({
  icon,
  title,
  detail,
  href,
  tone = "warn",
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  detail: string;
  href?: string;
  tone?: "warn" | "late";
  className?: string;
}) {
  const row = (
    <>
      <div
        className={`h-9 w-9 rounded-[11px] grid place-items-center flex-none ${
          tone === "late" ? "bg-late-soft text-late" : "bg-warn-soft text-warn"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[14px] font-medium leading-tight">{title}</p>
        <p className="mt-0.5 text-[12px] text-ink-3 leading-tight truncate">
          {detail}
        </p>
      </div>
      {href ? (
        <ChevronRight size={18} className="ml-auto text-ink-3 flex-none" />
      ) : (
        <span className="ml-auto h-[18px] w-[18px] flex-none" aria-hidden="true" />
      )}
    </>
  );

  const classes = `flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 py-3 ${className}`;
  return href ? (
    <Link href={href} className={classes}>
      {row}
    </Link>
  ) : (
    <div className={classes}>{row}</div>
  );
}
