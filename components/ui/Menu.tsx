"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";

// UI foundation — Menu.
//
// A small dropdown menu for the account/overflow affordances that used
// to be hand-rolled per screen. It implements the menu pattern by
// hand — trigger button with aria-haspopup/aria-expanded, a menu of
// menuitems, Escape to close, arrow keys to move, focus returns to the
// trigger — without pulling a menu library into the bundle.
//
// The items are supplied by the caller; this primitive never renders a
// destructive action as an equal of a primary one (that is the
// caller's composition decision, DESIGN.md §3).

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
};

export type MenuProps = {
  /** Accessible name of the menu and of the trigger. */
  label: string;
  trigger: ReactNode;
  items: ReadonlyArray<MenuItem>;
  align?: "start" | "end";
  className?: string;
};

export function Menu({
  label,
  trigger,
  items,
  align = "end",
  className,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function moveFocus(direction: 1 | -1) {
    const current = itemRefs.current.findIndex(
      (element) => element === document.activeElement,
    );
    const start = current < 0 ? (direction === 1 ? -1 : 0) : current;
    // Native disabled buttons cannot receive focus. Walk past them so
    // an unavailable action never traps arrow-key navigation.
    for (let distance = 1; distance <= items.length; distance++) {
      const index = (start + direction * distance + items.length) % items.length;
      if (!items[index]?.disabled) {
        itemRefs.current[index]?.focus();
        return;
      }
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 items-center gap-2 rounded-ctl px-3 text-[14px] font-medium text-ink-2 motion-fast transition-colors hover:bg-deck"
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={cn(
            "absolute z-[var(--z-overlay)] mt-1 min-w-[200px] rounded-ctl border border-line bg-paper p-1 shadow-2",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                item.onSelect?.();
              }}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[14px]",
                "text-ink-2 motion-fast transition-colors hover:bg-deck",
                item.disabled && "cursor-not-allowed opacity-60",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
