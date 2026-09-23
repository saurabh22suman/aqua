import Link from "next/link";

// PR3-C2 — link-based segmented tabs (server-friendly: no client JS,
// works in the zero-JS spirit anywhere a URL already carries the tab).
export function SegmentedTabs({
  tabs,
  active,
  ariaLabel = "Sections",
}: {
  tabs: ReadonlyArray<{ key: string; label: string; href: string }>;
  active: string;
  ariaLabel?: string;
}) {
  return (
    <nav
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
            className={`flex-none whitespace-nowrap rounded-pill px-3.5 py-2 text-center text-[12.5px] font-medium transition-colors duration-150 ${
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
