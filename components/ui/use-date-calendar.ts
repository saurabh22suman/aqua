"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from "react";
import type { DateCalendarAnchor } from "./DateCalendar";

// The date field's CALENDAR BEHAVIOUR.
//
// Opening, closing, dismissing and the focus rules are one concern, and
// they are the part of the field that has to be right in a consumer
// that saves on blur: moving the focus INTO the calendar is part of
// choosing a date, so it must never save or cancel an inline edit.
//
// The calendar's open state is mirrored in a ref, because a pointer
// press outside the field closes the calendar and the focus then moves
// in the SAME task: the blur that follows must see the calendar closed
// at once, not after the next render.
//
// OWNERSHIP. Every field owns ONE calendar, named by its own id. A
// press inside that calendar — its month and year listboxes included —
// is a press on the field's own popup and must not dismiss it. A press
// anywhere else, including inside ANOTHER field's calendar, is outside
// this field and dismisses it.

export type DateCalendarController = {
  open: boolean;
  anchor: DateCalendarAnchor | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
  /** The popup element, so the field can tell whether it owns it. */
  popupRef: RefObject<HTMLElement | null>;
  openCalendar: () => void;
  closeCalendar: (restoreFocus: boolean) => void;
  handleWrapperBlur: (event: FocusEvent<HTMLDivElement>) => void;
};

export function useDateCalendar({
  disabled,
  inputRef,
  onBlur,
  calendarId,
}: {
  disabled?: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onBlur?: () => void;
  /** This field's own calendar: the popup it draws and nothing else. */
  calendarId: string;
}): DateCalendarController {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DateCalendarAnchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);

  const closeCalendar = useCallback(
    (restoreFocus: boolean) => {
      openRef.current = false;
      setOpen(false);
      if (restoreFocus) inputRef.current?.focus();
    },
    [inputRef],
  );

  useEffect(() => {
    if (!open) return;
    // A press outside the field closes the calendar. It is a POINTER
    // listener on the document, so it runs before the focus moves.
    function onPointerDown(event: Event) {
      const target = event.target as Element | null;
      if (target && wrapperRef.current?.contains(target)) return;
      // The field's OWN calendar — and the popups it owns — are part of
      // the field. Another field's calendar is not.
      if (
        target &&
        target.closest?.(`[data-date-calendar="${calendarId}"]`)
      ) {
        return;
      }
      closeCalendar(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [calendarId, closeCalendar, open]);

  useEffect(() => {
    if (!open) return;
    // The trigger MOVES: the page scrolls under it, and the window is
    // resized. The popup is anchored to the trigger, so the anchor is
    // measured again — not remembered from the moment the calendar
    // opened, which would leave the popup where the trigger WAS.
    function measure() {
      const rect =
        triggerRef.current?.getBoundingClientRect() ??
        inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor((current) =>
        current &&
        current.top === rect.top &&
        current.bottom === rect.bottom &&
        current.left === rect.left
          ? current
          : { top: rect.top, bottom: rect.bottom, left: rect.left },
      );
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [inputRef, open]);

  function openCalendar() {
    if (disabled) return;
    const rect =
      triggerRef.current?.getBoundingClientRect() ??
      inputRef.current?.getBoundingClientRect();
    setAnchor(
      rect
        ? { top: rect.top, bottom: rect.bottom, left: rect.left }
        : { top: 0, bottom: 0, left: 0 },
    );
    openRef.current = true;
    setOpen(true);
  }

  /**
   * The consumer is told when the focus LEAVES the field, not when it
   * leaves the text box: moving the focus into the calendar is part of
   * choosing a date and must never save or cancel an inline edit.
   *
   * Leaving the WHOLE field — the text box, the calendar and any popup
   * it owns — ends the edit: the consumer is told, and the calendar is
   * dismissed. A blur that is suppressed for ever would leave the
   * consumer's draft open with no way to save it.
   */
  function handleWrapperBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    // Still inside the field.
    if (next && event.currentTarget.contains(next)) return;
    // Moved into the calendar, or into a popup the calendar owns.
    if (next && popupRef.current?.contains(next)) return;
    // The calendar is open and the browser did not say where the focus
    // went: the calendar has probably taken it, so the edit is not over.
    if (!next && openRef.current) return;
    // The focus LEFT the whole field: the edit is over, and the popup
    // goes with it.
    if (openRef.current) closeCalendar(false);
    onBlur?.();
  }

  return {
    open,
    anchor,
    triggerRef,
    wrapperRef,
    popupRef,
    openCalendar,
    closeCalendar,
    handleWrapperBlur,
  };
}
