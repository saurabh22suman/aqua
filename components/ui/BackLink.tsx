import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// Phase 4 (mobile UX plan v2) — F13. The five detail pages that had no
// way back and the three that hand-rolled the same link all render
// this. The 44px minimum row height matters: the old inline links were
// ~20px tall, below the DESIGN.md §2 floor and awkward one-handed.

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 min-h-11 text-[13px] text-ink-3 hover:text-ink mb-4"
    >
      <ChevronLeft size={16} aria-hidden="true" />
      {label}
    </Link>
  );
}
