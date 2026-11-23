"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

// Ops redesign (28 October 2026) — the section tab bar.
//
// Each tab is a real route, not client-side state, so a link to a
// specific tab is shareable and the Back button behaves. The current
// tab is resolved from the URL — the same way the navigation rail
// resolves the current section — so the two can never disagree.
//
// The bar scrolls sideways inside itself when the tabs do not fit; it
// never moves the page sideways.

export type OpsTab = {
  /** The absolute href of the tab. */
  href: string;
  label: string;
};

export function OpsTabs({
  label,
  tabs,
}: {
  /** The landmark's accessible name, e.g. "Tenant". */
  label: string;
  tabs: readonly OpsTab[];
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={label}
      className="-mb-px mt-4 flex gap-1 overflow-x-auto border-b border-line"
    >
      {tabs.map((tab) => {
        const current = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors duration-150",
              current
                ? "border-[var(--accent-strong)] text-ink"
                : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
