import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export function BottomNav({ items, active }: { items: NavItem[]; active: string }) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 h-16 bg-paper border-t border-line shadow-2 grid"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const isActive = active === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${
              isActive ? "text-[var(--accent-ink)]" : "text-ink-3"
            }`}
          >
            <item.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
