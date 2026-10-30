// The shared owner calendar — the date controls.
//
// The calendar does NOT restate the control metrics. Its date
// controls are the shared Button primitive at its standard toolbar
// size, so they measure the same as every other owner toolbar and
// carry the same focus, disabled and hover states.
//
// Only the LINK-versus-CALLBACK choice is the calendar's own: a
// server-driven surface navigates by URL, a client-driven one calls a
// handler. The appearance is the shared primitive's either way.

import Link from "next/link";

import { buttonClasses } from "@/components/ui/Button";

import type { CalendarNavTarget } from "./owner-calendar-types";

export function CalendarNavControl({
  target,
  testId,
  className = "",
  ariaLabel,
  children,
}: {
  target: CalendarNavTarget;
  testId?: string;
  className?: string;
  /** Full accessible name when the visible text is short. */
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const classNames = buttonClasses({
    variant: "secondary",
    size: "md",
    className,
  });
  if ("href" in target) {
    return (
      <Link
        href={target.href}
        className={classNames}
        data-testid={testId}
        aria-label={ariaLabel}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={target.onSelect}
      className={classNames}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
