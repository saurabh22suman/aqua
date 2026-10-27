"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import {
  MENU_MIN_WIDTH,
  clipRect,
  computeMenuBounds,
  findClipAncestor,
  isRectVisible,
  subscribeToViewportChanges,
  visibleViewportRect,
  type MenuBounds,
} from "./menu-bounds";
import { resolveTriggerName } from "./menu-name";

// UI foundation — Menu.
//
// A dropdown menu for the account/overflow affordances that used to be
// hand-rolled per screen: the menu pattern by hand — trigger with
// aria-haspopup/aria-expanded, menuitems, Escape to close, arrow keys
// to move, focus back to the trigger — without a menu library.
//
// The contract (the menu-button pattern): Enter / Space / ArrowDown
// open it on the first available action, ArrowUp on the last one, the
// arrows walk the available actions and wrap, Home / End jump to the
// ends, Escape closes it and gives the focus back, Tab leaves in the
// browser's own order (never a trap) and closes it, a press outside
// dismisses it. Unavailable actions are skipped, never focused. The
// items are the caller's; this primitive never renders a destructive
// action as an equal of a primary one (DESIGN.md §3).
//
// While it is open the menu follows the screen (resize, rotation, the
// phone keyboard, a scroll, a clipping column) — see menu-bounds.ts.

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
};

export type MenuProps = {
  /** The menu's name, and the trigger's fallback name (an icon-only trigger). */
  label: string;
  triggerLabel?: string;
  trigger: ReactNode;
  items: ReadonlyArray<MenuItem>;
  align?: "start" | "end";
  className?: string;
};

export function Menu({
  label,
  triggerLabel,
  trigger,
  items,
  align = "end",
  className,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [bounds, setBounds] = useState<MenuBounds | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const clipAncestorRef = useRef<HTMLElement | null>(null);
  const menuId = useId();

  const available = items.reduce<number[]>((indexes, item, index) => {
    if (!item.disabled) indexes.push(index);
    return indexes;
  }, []);
  const firstAvailable = available[0];
  const lastAvailable = available[available.length - 1];

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    pendingFocusRef.current = null;
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Put the menu back inside what the user can see.
  const applyBounds = useCallback(
    () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const box = trigger.getBoundingClientRect();
      const visible = visibleViewportRect();
      const clip = clipRect(clipAncestorRef.current);
      if (!isRectVisible(box, visible, clip)) {
        // The trigger left the screen: the menu would float over
        // nothing, so it closes rather than hanging there.
        closeMenu(false);
        return;
      }
      setBounds(computeMenuBounds({ trigger: box, visible, clip, align }));
    },
    [align, closeMenu],
  );

  // The keyboard opens the menu on an action; the pointer opens it with
  // the focus left on the trigger.
  function openMenu(edge?: "first" | "last") {    if (items.length === 0) return;
    const target = edge === "last" ? lastAvailable : firstAvailable;
    setActiveIndex(target ?? -1);
    pendingFocusRef.current = edge === undefined ? null : (target ?? null);
    clipAncestorRef.current = findClipAncestor(rootRef.current);
    applyBounds();
    setOpen(true);
  }

  function focusItem(index: number) {
    setActiveIndex(index);
    itemRefs.current[index]?.focus();
  }

  function focusEdge(edge: "first" | "last") {
    const target = edge === "first" ? firstAvailable : lastAvailable;
    if (target !== undefined) focusItem(target);
  }

  function moveFocus(direction: 1 | -1) {
    const current = itemRefs.current.findIndex(
      (element) => element === document.activeElement,
    );
    if (current < 0) {
      // The focus has not entered the menu yet (the trigger still has
      // it): ArrowDown enters at the first action, ArrowUp at the last.
      focusEdge(direction === 1 ? "first" : "last");
      return;
    }
    const position = available.indexOf(current);
    if (position < 0) return;
    const next = available[(position + direction + available.length) % available.length];
    if (next !== undefined && next !== current) focusItem(next);
  }

  // Closing after Tab happens one task later: the browser must first
  // move the focus out of the menu, and it can only do that while the
  // focused action is still in the document.
  function closeAfterTab() {
    if (closeTimerRef.current !== null) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      closeMenu(false);
    }, 0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const onTrigger = event.target === triggerRef.current;
    const { key } = event;
    if (key === "Escape") {
      if (!open) return;
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (!open) {
      // Closed: only the trigger opens the menu, and the key replaces
      // the button's own click so the focus can move onto an action.
      if (!onTrigger) return;
      if (key === "ArrowDown" || key === "Enter" || key === " ") {
        event.preventDefault();
        openMenu("first");
      } else if (key === "ArrowUp") {
        event.preventDefault();
        openMenu("last");
      }
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      moveFocus(key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (key === "Home" || key === "End") {
      event.preventDefault();
      focusEdge(key === "Home" ? "first" : "last");
      return;
    }
    if (key === "Tab") {
      // The default is left alone: the browser keeps its own tab order
      // and the menu is never a focus trap.
      if (onTrigger) closeMenu(false);
      else closeAfterTab();
    }
  }

  // A press outside dismisses the menu. The focus is not pulled back —
  // whatever the user pressed keeps it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, closeMenu]);

  // The action the keyboard asked for is focused once it is on screen.
  useEffect(() => {
    if (!open) return;
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    itemRefs.current[target]?.focus();
  }, [open]);

  // While the menu is open it follows the screen.
  useEffect(() => {
    if (!open) return;
    const ancestor = clipAncestorRef.current ?? findClipAncestor(rootRef.current);
    clipAncestorRef.current = ancestor;
    const update = () => applyBounds();
    update();
    return subscribeToViewportChanges(ancestor, update);
  }, [open, applyBounds]);

  // A pending "close after Tab" must not outlive the component.
  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);
  const triggerName = resolveTriggerName({ label, triggerLabel, trigger });
  const resolvedAlign = bounds?.align ?? align;
  const placement = bounds?.placement ?? "below";

  return (
    <div ref={rootRef} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerName}
        onClick={() => (open ? closeMenu(true) : openMenu())}
        className="inline-flex min-h-11 items-center gap-2 rounded-ctl px-3 text-[14px] font-medium text-ink-2 motion-fast transition-colors hover:bg-deck"
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={{
            maxHeight: bounds ? `${bounds.maxHeight}px` : undefined,
            maxWidth: bounds ? `${bounds.maxWidth}px` : undefined,
            minWidth: bounds ? `${Math.min(MENU_MIN_WIDTH, bounds.maxWidth)}px` : undefined,
            // Nudged beside the trigger so it stays on the screen.
            marginLeft: bounds && resolvedAlign === "start" ? `${bounds.offset}px` : undefined,
            marginRight: bounds && resolvedAlign === "end" ? `${-bounds.offset}px` : undefined,
            overflowY: "auto",
          }}
          className={cn(
            "absolute z-[var(--z-overlay)] rounded-ctl border border-line bg-paper p-1 shadow-2",
            "max-h-[min(20rem,calc(100dvh_-_2rem))] overscroll-contain",
            resolvedAlign === "end" ? "right-0" : "left-0",
            placement === "above" ? "bottom-full mb-1" : "mt-1",
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
              // One action is in the tab order at a time, so the menu is
              // a single stop and Tab leaves it.
              tabIndex={index === activeIndex ? 0 : -1}
              aria-disabled={item.disabled ? true : undefined}
              disabled={item.disabled}
              onFocus={() => setActiveIndex(index)}
              onClick={() => {
                closeMenu(true);
                item.onSelect?.();
              }}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[14px]",
                "text-ink-2 motion-fast transition-colors hover:bg-deck",
                item.disabled && "cursor-not-allowed opacity-60",
              )}
            >
              {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
              <span className="min-w-0 break-words">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
