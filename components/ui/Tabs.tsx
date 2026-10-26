"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

// UI foundation — Tabs.
//
// The in-page variant: a tablist with roving tabindex, arrow-key
// navigation and Home/End. (Tabs that are really navigation — the Fees
// hub's ?tab= state — stay server-rendered links; see
// components/ui/SegmentedTabs.tsx. This primitive is for tabs that
// switch content in place.)

export type TabItem = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type TabsProps = {
  /** Accessible name of the tab list. */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  tabs: ReadonlyArray<TabItem>;
  className?: string;
};

export function Tabs({ label, value, onValueChange, tabs, className }: TabsProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((tab) => tab.value === value);
    if (current === -1) return;
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;

    event.preventDefault();
    const target = tabs[next];
    if (!target || target.disabled) return;
    onValueChange(target.value);
    itemRefs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={moveFocus}
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-ctl bg-deck p-1",
        className,
      )}
    >
      {tabs.map((tab, index) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onValueChange(tab.value)}
            className={cn(
              "min-h-11 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-medium",
              "motion-fast transition-colors",
              selected
                ? "bg-paper text-ink shadow-1"
                : "text-ink-2 hover:text-ink",
              tab.disabled && "cursor-not-allowed opacity-60",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
