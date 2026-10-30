"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

// PR3-C2 — link-based segmented tabs. The links stay real server
// destinations and work without client JavaScript; the small effect
// below only reveals the active tab when the horizontal bar is wider
// than the phone. It never scrolls the page or moves focus.

export function SegmentedTabs({
  tabs,
  active,
  ariaLabel = "Sections",
}: {
  tabs: ReadonlyArray<{ key: string; label: string; href: string }>;
  active: string;
  ariaLabel?: string;
}) {
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const activeLink = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!activeLink) return;

    const navRect = nav.getBoundingClientRect();
    const activeRect = activeLink.getBoundingClientRect();
    const clippedLeft = activeRect.left < navRect.left;
    const clippedRight = activeRect.right > navRect.right;
    if (!clippedLeft && !clippedRight) return;

    // Move the nav's own scroll offset only: no scrollIntoView (which can
    // move the page), no focus change, no animation library. Instant
    // positioning also honours reduced-motion without a special case.
    const centered =
      nav.scrollLeft +
      (activeRect.left - navRect.left) -
      (nav.clientWidth - activeRect.width) / 2;
    const maximum = Math.max(0, nav.scrollWidth - nav.clientWidth);
    nav.scrollLeft = Math.max(0, Math.min(centered, maximum));
  }, [active]);

  return (
    <nav
      ref={navRef}
      aria-label={ariaLabel}
      className="flex gap-1 overflow-x-auto rounded-pill bg-deck p-1 [scrollbar-width:none]"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex-none inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-pill px-3.5 py-2 text-center text-[12.5px] font-medium transition-colors duration-150 ${
              isActive ? "bg-paper text-ink shadow-1" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
