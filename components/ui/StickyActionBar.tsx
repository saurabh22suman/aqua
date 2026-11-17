import type { ReactNode } from "react";

// PR3-C2 — sticky action bar for mobile primary actions. The bar sits
// above the four-item bottom nav; it is layout, not a new control.
export function StickyActionBar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur lg:-mx-7 lg:px-7 ${className}`}
      data-testid="sticky-action-bar"
    >
      {children}
    </div>
  );
}
