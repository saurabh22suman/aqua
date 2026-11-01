"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { RIBBON_TILE_SIZE, ribbonBounds, type RibbonBounds } from "./install-ribbon-geometry";
import {
  headerClearance,
  safeAreaBottom,
  viewportHeight,
} from "./install-ribbon-measure";
import { useInstallRibbonDock, type InstallRibbonDock } from "./use-install-ribbon-dock";
import { useInstallRibbonMove } from "./use-install-ribbon-move";
import { useInstallRibbonSuppression } from "./use-install-ribbon-suppression";

// The install ribbon's own state: how far it is open, and where it sits
// on the screen edge.
//
// Everything here is presentation state. The ribbon never persists a
// position, never stores an identity and never talks to the network: the
// install policy lives in components/pwa/install-affordance.tsx.
//
// The placement correction of 30 October 2026 (root): the ribbon is
// docked to the RIGHT edge and the panel opens inward, to the left. A
// left-edge ribbon would sit over the desktop sidebar navigation, and
// obstructing navigation is the stronger requirement.
//
// The three focused leaves keep this hook small: use-install-ribbon-dock
// owns where the tab may sit, use-install-ribbon-move owns the move
// handle, and use-install-ribbon-suppression owns the "get out of the
// way" rule.

export type InstallRibbonPhase = "closed" | "opening" | "open";

export type UseInstallRibbonOptions = {
  /** How long an expanded ribbon stays open before it folds back. */
  visibleDurationMs: number;
};

export type InstallRibbonController = {
  expanded: boolean;
  phase: InstallRibbonPhase;
  /** The ribbon's top offset in px. */
  top: number;
  /**
   * Where the collapsed tab may sit: "gutter" (inside the page's own
   * gutter), "clear" (a place confirmed clear of every control), "none"
   * (nowhere, so the ribbon does not render) or "unknown" (not measured
   * yet).
   */
  dock: InstallRibbonDock;
  /** True while the ribbon must stay out of the way. */
  suppressed: boolean;
  /** True while the person is dragging the ribbon. */
  dragging: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  tabRef: RefObject<HTMLButtonElement | null>;
  /** Open the ribbon if it is closed, fold it away if it is open. */
  toggle: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Any gesture inside the ribbon. */
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onHandlePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onHandlePointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onHandlePointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onHandlePointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onHandleKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
  /** The handle's own tap: move to the next bounded stop. */
  cycleStop: () => void;
};

export function useInstallRibbon({
  visibleDurationMs,
}: UseInstallRibbonOptions): InstallRibbonController {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tabRef = useRef<HTMLButtonElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [animation, setAnimation] = useState<"opening" | "open">("open");
  const [top, setTopState] = useState(0);
  /** Where the person put the ribbon; null means the default place. */
  const [requestedTop, setRequestedTop] = useState<number | null>(null);
  const [bounds, setBounds] = useState<RibbonBounds>({ minTop: 0, maxTop: 0 });

  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const topRef = useRef(top);
  topRef.current = top;
  const boundsRef = useRef<RibbonBounds>(bounds);
  boundsRef.current = bounds;

  const phase: InstallRibbonPhase = expanded ? animation : "closed";

  const getTop = useCallback(() => topRef.current, []);
  const getBounds = useCallback(() => boundsRef.current, []);
  const onPlaced = useCallback(() => {}, []);
  const requestTop = useCallback((next: number) => {
    setRequestedTop(next);
  }, []);

  const measure = useCallback(() => {
    const measured = rootRef.current?.getBoundingClientRect().height ?? 0;
    // The collapsed ribbon IS the 44px tab: the panel is hidden, so it
    // takes no room. Measuring it before the ribbon has rendered would
    // give a band that is too tall, and the ribbon would be placed in
    // the middle of a band that does not exist.
    const next = ribbonBounds({
      viewportHeight: viewportHeight(),
      ribbonHeight: expanded ? measured || RIBBON_TILE_SIZE : RIBBON_TILE_SIZE,
      headerClearance: headerClearance(),
      safeAreaBottom: safeAreaBottom(),
    });
    boundsRef.current = next;
    setBounds(next);
  }, [expanded]);

  // The ribbon measures itself, and is measured again whenever the
  // viewport changes: a rotation, a resize or the on-screen keyboard
  // opening all move the band it may live in.
  useEffect(() => {
    measure();
    const onViewportChange = () => measure();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", onViewportChange);
    viewport?.addEventListener("scroll", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
      viewport?.removeEventListener("resize", onViewportChange);
      viewport?.removeEventListener("scroll", onViewportChange);
    };
  }, [measure, expanded, animation]);

  const move = useInstallRibbonMove({ getTop, getBounds, requestTop, onPlaced });
  const dock = useInstallRibbonDock({
    rootRef,
    bounds,
    requestedTop,
    dragging: move.dragging,
  });

  // The dock decides where the ribbon may sit: it checks the ACTUAL
  // position, not only the preferred one, and it checks again whenever
  // the page moves under the ribbon.
  useEffect(() => {
    setTopState(dock.top);
  }, [dock.top]);

  // A slide is a user expansion only: the ribbon never opens by itself,
  // so every slide is a slide the person asked for.
  useEffect(() => {
    if (animation !== "opening") return;
    if (typeof window.requestAnimationFrame !== "function") {
      setAnimation("open");
      return;
    }
    const frame = window.requestAnimationFrame(() => setAnimation("open"));
    return () => window.cancelAnimationFrame(frame);
  }, [animation]);

  const suppressed = useInstallRibbonSuppression(rootRef);
  const isDragging = move.isDragging;

  // The ribbon folds back into its tab on its own, unless the person is
  // using it: a keyboard focus inside the ribbon or an active drag
  // keeps it open.
  useEffect(() => {
    if (!expanded) return;
    let timer: number | undefined;
    const fold = () => {
      if (!expandedRef.current) return;
      const root = rootRef.current;
      const active = document.activeElement;
      const busy =
        isDragging() ||
        (root !== null && active instanceof HTMLElement && root.contains(active));
      if (busy) {
        timer = window.setTimeout(fold, 1000);
        return;
      }
      setExpanded(false);
    };
    timer = window.setTimeout(fold, visibleDurationMs);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [expanded, visibleDurationMs, isDragging]);

  const expand = useCallback(() => {
    if (expandedRef.current) return;
    setAnimation("opening");
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    setExpanded(false);
  }, []);

  const toggle = useCallback(() => {
    if (expandedRef.current) collapse();
    else expand();
  }, [collapse, expand]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !expandedRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    setExpanded(false);
    // The focus goes back to the tab that opened it.
    tabRef.current?.focus();
  }, []);

  return {
    expanded,
    phase,
    top,
    dock: dock.dock,
    suppressed,
    dragging: move.dragging,
    rootRef,
    tabRef,
    toggle,
    onKeyDown,
    onPointerDown: move.onPointerDown,
    onHandlePointerDown: move.onHandlePointerDown,
    onHandlePointerMove: move.onHandlePointerMove,
    onHandlePointerUp: move.onHandlePointerUp,
    onHandlePointerCancel: move.onHandlePointerCancel,
    onHandleKeyDown: move.onHandleKeyDown,
    onClickCapture: move.onClickCapture,
    cycleStop: move.cycleStop,
  };
}
