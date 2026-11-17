"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

// UI foundation — TransientDisclosure.
//
// A native <details> that also behaves like a menu. The native
// disclosure still opens and closes the surface (no JavaScript is
// needed for that, and the browser's own disclosure semantics stay),
// but the surface now dismisses itself the way a menu does:
//
//   - a press outside it (mouse, touch or pen) closes it, and the
//     dismissal never takes the focus away from what the user pressed;
//   - the focus leaving it closes it;
//   - Escape closes it and gives the focus back to its OWN trigger;
//   - leaving the route closes it (a browser Back included);
//   - choosing a navigation action inside it closes it;
//   - opening another transient surface closes this one.
//
// The children stay the caller's: the surface never submits a form,
// never reaches a sign-out and never removes a control. A genuine
// disclosure (a report, a form, a help panel) does NOT use this
// primitive — it keeps the plain native <details> and its own state.

type TransientSurface = {
  close: (restoreFocus: boolean) => void;
};

// The open transient surfaces. They live in different parts of the
// shell (the header account control, the mobile record search, the
// mobile "More" menu) and none of them knows about the others, so the
// module keeps the list: opening one closes the others.
const openSurfaces = new Set<TransientSurface>();

export type TransientDisclosureProps = {
  /** The trigger's content. It is rendered inside the native <summary>. */
  trigger: ReactNode;
  /** The disclosed content. */
  children: ReactNode;
  /** The <details> element's classes. */
  className?: string;
  /** The native <summary> trigger's classes. */
  triggerClassName?: string;
};

export function TransientDisclosure({
  trigger,
  children,
  className,
  triggerClassName,
}: TransientDisclosureProps) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const routeRef = useRef(pathname);

  const close = useCallback((restoreFocus: boolean) => {
    const details = detailsRef.current;
    if (details && details.open) details.open = false;
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // The browser owns the disclosure's open state; this only tells the
  // surface when it is open, so the listeners below are there exactly
  // while it is.
  function onTriggerClick() {
    // The browser has not toggled the disclosure yet, so the current
    // state says which way the user is going.
    if (detailsRef.current?.open) {
      setOpen(false);
      return;
    }
    setOpen(true);
  }

  // A navigation action inside the surface closes it.
  function onSurfaceClick(event: React.MouseEvent<HTMLDetailsElement>) {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return;
    if (!target.closest("a")) return;
    close(true);
  }

  function onSurfaceKeyDown(event: React.KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape") return;
    if (!detailsRef.current?.open) return;
    event.preventDefault();
    close(true);
  }

  // While the surface is open it watches for the ways a menu closes.
  useEffect(() => {
    if (!open) return;
    const details = detailsRef.current;

    function onPressOutside(event: Event) {
      const target = event.target as Node | null;
      if (!target) return;
      if (details && details.contains(target)) return;
      // The focus is not pulled back: whatever the user pressed keeps it.
      close(false);
    }

    function onFocusOut(event: FocusEvent) {
      const next = event.relatedTarget as Node | null;
      if (next && details && details.contains(next)) return;
      close(false);
    }

    document.addEventListener("pointerdown", onPressOutside, true);
    document.addEventListener("mousedown", onPressOutside, true);
    document.addEventListener("touchstart", onPressOutside, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      document.removeEventListener("pointerdown", onPressOutside, true);
      document.removeEventListener("mousedown", onPressOutside, true);
      document.removeEventListener("touchstart", onPressOutside, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, [open, close]);

  // Only one transient surface is open at a time: opening one closes
  // the others.
  useEffect(() => {
    if (!open) return;
    const surface: TransientSurface = { close };
    openSurfaces.add(surface);
    for (const other of Array.from(openSurfaces)) {
      if (other !== surface) other.close(false);
    }
    return () => {
      openSurfaces.delete(surface);
    };
  }, [open, close]);

  // Leaving the route closes the surface: a browser Back included.
  useEffect(() => {
    if (routeRef.current === pathname) return;
    routeRef.current = pathname;
    close(false);
  }, [pathname, close]);

  // The browser owns the disclosure's open state; this keeps the
  // surface's own state in step with it.
  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const onToggle = () => {
      setOpen(details.open);
    };
    details.addEventListener("toggle", onToggle);
    return () => details.removeEventListener("toggle", onToggle);
  }, []);

  return (
    <details
      ref={detailsRef}
      className={className}
      onClick={onSurfaceClick}
      onKeyDown={onSurfaceKeyDown}
    >
      <summary ref={triggerRef} className={triggerClassName} onClick={onTriggerClick}>
        {trigger}
      </summary>
      {children}
    </details>
  );
}
