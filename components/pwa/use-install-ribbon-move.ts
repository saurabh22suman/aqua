"use client";

import { useCallback, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import {
  RIBBON_DRAG_THRESHOLD,
  RIBBON_KEY_STEP,
  dragRibbonTop,
  nextRibbonStop,
  stepRibbonTop,
  type RibbonBounds,
} from "./install-ribbon-geometry";

// The move handle: the one control that places the ribbon.
//
// It is deliberately neither the install action nor the collapse
// control, and it is a progressive enhancement: the ribbon is fully
// usable without it. Tapping the handle cycles the three bounded stops,
// the arrow keys move it, and dragging it moves it along the edge.
//
// A drag must never become a click. The click that the browser fires
// after a real drag is swallowed, so the ribbon never installs and never
// cycles a stop by accident. A CANCELLED gesture produces no click at
// all, so a cancel must not leave a suppression waiting to swallow the
// next deliberate click.

type Drag = {
  pointerId: number;
  startY: number;
  startTop: number;
  moved: boolean;
};

export type UseInstallRibbonMoveOptions = {
  /** The ribbon's current top offset — where the person sees it. */
  getTop: () => number;
  /** The band the ribbon may move in. */
  getBounds: () => RibbonBounds;
  /** Asks for a new top offset; the dock checks that the place is clear. */
  requestTop: (top: number) => void;
  /** Records that the person placed the ribbon themselves. */
  onPlaced: () => void;
};

export type InstallRibbonMove = {
  /** True while the person is dragging the ribbon. */
  dragging: boolean;
  /** Any gesture inside the ribbon: a new gesture clears a stale suppression. */
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onHandlePointerDown: (event: PointerEvent<HTMLElement>) => void;
  onHandlePointerMove: (event: PointerEvent<HTMLElement>) => void;
  onHandlePointerUp: (event: PointerEvent<HTMLElement>) => void;
  onHandlePointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onHandleKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  /** The handle's own tap: move to the next bounded stop. */
  cycleStop: () => void;
  /** True while a drag is in progress. */
  isDragging: () => boolean;
};

export function useInstallRibbonMove({
  getTop,
  getBounds,
  requestTop,
  onPlaced,
}: UseInstallRibbonMoveOptions): InstallRibbonMove {
  const dragRef = useRef<Drag | null>(null);
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(() => {
    // A new gesture clears a stale suppression, so only the click that
    // really follows a drag is ever swallowed.
    suppressClickRef.current = false;
  }, []);

  const onHandlePointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      dragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startTop: getTop(),
        moved: false,
      };
      const target = event.currentTarget;
      if (typeof target.setPointerCapture === "function") {
        try {
          target.setPointerCapture(event.pointerId);
        } catch {
          // The browser refused the capture; the drag still works.
        }
      }
      setDragging(true);
    },
    [getTop],
  );

  const onHandlePointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const travel = event.clientY - drag.startY;
      if (Math.abs(travel) <= RIBBON_DRAG_THRESHOLD) return;
      drag.moved = true;
      onPlaced();
      requestTop(dragRibbonTop(drag.startTop, drag.startY, event.clientY, getBounds()));
    },
    [getBounds, onPlaced, requestTop],
  );

  const endDrag = useCallback((event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    // A cancelled gesture never produces a following click, so it must
    // not leave a suppression waiting to swallow the next one.
    if (drag.moved && !cancelled) suppressClickRef.current = true;
  }, []);

  const onHandlePointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => endDrag(event, false),
    [endDrag],
  );

  const onHandlePointerCancel = useCallback(
    (event: PointerEvent<HTMLElement>) => endDrag(event, true),
    [endDrag],
  );

  const onHandleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      onPlaced();
      const delta = event.key === "ArrowUp" ? -RIBBON_KEY_STEP : RIBBON_KEY_STEP;
      requestTop(stepRibbonTop(getTop(), delta, getBounds()));
    },
    [getBounds, getTop, onPlaced, requestTop],
  );

  const onClickCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const cycleStop = useCallback(() => {
    onPlaced();
    requestTop(nextRibbonStop(getTop(), getBounds()));
  }, [getBounds, getTop, onPlaced, requestTop]);

  const isDragging = useCallback(() => dragRef.current !== null, []);

  return {
    dragging,
    onPointerDown,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel,
    onHandleKeyDown,
    onClickCapture,
    cycleStop,
    isDragging,
  };
}
