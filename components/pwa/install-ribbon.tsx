"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical.mjs";
import { useInstallRibbon } from "./use-install-ribbon";

// The install ribbon.
//
// The human asked for the install offer to arrive "like a ribbon coming
// from the side, and collapsable, and draggable if possible? like quick
// shortcut things" (docs/design/pwa-side-ribbon-20261030/ribbon-contract.md).
//
// What it is:
//
//   * A slim tab on the right edge of the screen. A tap opens the
//     install options; a tap again folds them away. The wording is
//     horizontal — a rotated vertical word is unreadable.
//   * NEVER A MODAL. No dialog role, no aria-modal, no focus trap, no
//     focus theft, no page blocking. The page underneath stays usable.
//   * HONEST. The browser's own install event is called by the explicit
//     Install click and by nothing else; iOS and iPadOS get accurate
//     "Add to Home Screen" guidance instead of a button that pretends
//     to install.
//   * MOVEABLE, not draggable-only. A dedicated move handle — neither
//     the install action nor the collapse control — drags the ribbon
//     along the edge. Tapping the handle cycles three bounded stops and
//     the arrow keys move it, so the ribbon is fully usable without any
//     dragging at all.
//   * QUIET. A short transform/opacity slide from the edge, only on a
//     user expansion, using the existing motion tokens.
//
// The independent Chrome review of 30 October 2026 changed two things:
//
//   * the ribbon now ARRIVES COLLAPSED and opens only when the person
//     asks. An opening panel could cover the page's filters, and the
//     review also found the collapsed ribbon as a column of floating
//     tiles that covered the Members row links;
//   * the collapsed ribbon is now ONE slim tab, sized from the page's
//     own right gutter so it never paints over the content, and the
//     move handle exists only while the ribbon is open.
//
// The placement correction of 30 October 2026 (root): the ribbon is
// docked to the RIGHT edge and the panel opens inward, to the left. A
// left-edge ribbon would sit over the desktop sidebar navigation, and
// obstructing navigation is the stronger requirement.
//
// The install policy itself (the delay, the dismissal window, the
// platform rules) lives in lib/offline/install-prompt.ts and in
// components/pwa/install-affordance.tsx.

export type InstallRibbonProps = {
  /** "browser-prompt" offers the real install; "ios-guide" offers guidance. */
  availability: "browser-prompt" | "ios-guide";
  /** Runs the browser's own install prompt. Only the Install button calls it. */
  onInstall: () => void;
  /** The explicit "Not now": remembered for a month. */
  onDismiss: () => void;
  /** How long an expanded ribbon stays open before it folds back. */
  visibleDurationMs: number;
};

export function InstallRibbon({
  availability,
  onInstall,
  onDismiss,
  visibleDurationMs,
}: InstallRibbonProps) {
  const panelId = useId();
  const ribbon = useInstallRibbon({ visibleDurationMs });

  // Nothing to place yet, or nowhere to place it: the ribbon does not
  // render. A ribbon that covers a row, or that steals a row's click, is
  // worse than no ribbon.
  if (ribbon.suppressed || ribbon.dock === "unknown" || ribbon.dock === "none") return null;

  // Human decision, 30 October: supported browsers install directly
  // from the side shortcut. There is no expanded card to obscure fields.
  // The existing gesture controller suppresses the click after a drag.
  if (availability === "browser-prompt") {
    return (
      <div
        ref={ribbon.rootRef}
        data-ribbon="install"
        data-ribbon-edge="right"
        data-ribbon-dock={ribbon.dock}
        style={{ top: `${ribbon.top}px` }}
        className="fixed right-0 z-40"
        onPointerDown={ribbon.onPointerDown}
        onClickCapture={ribbon.onClickCapture}
      >
        <button
          ref={ribbon.tabRef}
          type="button"
          aria-label="Install Aqua"
          aria-describedby={panelId}
          title="Install Aqua · drag or use arrow keys to move"
          onClick={onInstall}
          onKeyDown={ribbon.onHandleKeyDown}
          onPointerDown={ribbon.onHandlePointerDown}
          onPointerMove={ribbon.onHandlePointerMove}
          onPointerUp={ribbon.onHandlePointerUp}
          onPointerCancel={ribbon.onHandlePointerCancel}
          className="flex h-11 w-11 touch-none select-none items-center justify-center rounded-l-ctl border border-r-0 border-line bg-paper text-ink-2 shadow-1 motion-base transition-colors hover:bg-deck"
        >
          <Download size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <span id={panelId} className="sr-only">
          Activate to install. Drag or use the up and down arrow keys to move the shortcut.
        </span>
      </div>
    );
  }

  return (
    <div
      ref={ribbon.rootRef}
      data-ribbon="install"
      data-ribbon-edge="right"
      data-ribbon-dock={ribbon.dock}
      style={{ top: `${ribbon.top}px` }}
      className="fixed right-0 z-40 flex items-start gap-2 pr-0"
      onKeyDown={ribbon.onKeyDown}
      onPointerDown={ribbon.onPointerDown}
      onClickCapture={ribbon.onClickCapture}
    >
      <section
        id={panelId}
        aria-label="Install Aqua"
        data-ribbon-phase={ribbon.phase}
        // The collapsed panel stays in the DOM so aria-controls always
        // resolves, but it is really hidden: the attribute for the
        // browser's own default, the utility for the styled cascade.
        hidden={ribbon.phase === "closed"}
        className={cn(
          "w-60 rounded-card border border-line bg-paper p-3 shadow-2",
          "transition-[opacity,transform] duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-standard)]",
          "motion-reduce:transition-none motion-reduce:translate-x-0 motion-reduce:opacity-100",
          ribbon.phase === "opening" ? "translate-x-3 opacity-0" : "translate-x-0 opacity-100",
          ribbon.phase === "closed" && "hidden",
        )}
      >
        <div className="flex flex-col items-start gap-2">
          <span className="text-[13px] leading-tight text-ink-2">
            Share &#9656; Add to Home Screen
          </span>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Not now
          </Button>
        </div>
      </section>

      <div className="flex flex-col items-center gap-1">
        <button
          ref={ribbon.tabRef}
          type="button"
          aria-expanded={ribbon.expanded}
          aria-controls={panelId}
          aria-label="Install options"
          title="Install Aqua"
          onClick={ribbon.toggle}
          // ONE 44px tab, flat against the screen edge. It is never
          // narrowed to fit a tight page: the shared control contract
          // is 44px, and where the page cannot hold it the ribbon is
          // placed elsewhere or not at all.
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-l-ctl border border-r-0 border-line bg-paper text-ink-2 shadow-1 motion-base transition-colors hover:bg-deck"
        >
          <Download size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
        {/* The move handle exists only while the ribbon is open: the
            collapsed ribbon is a single tile. */}
        {ribbon.expanded ? (
          <button
            type="button"
            aria-label="Move install ribbon"
            onClick={ribbon.cycleStop}
            onKeyDown={ribbon.onHandleKeyDown}
            onPointerDown={ribbon.onHandlePointerDown}
            onPointerMove={ribbon.onHandlePointerMove}
            onPointerUp={ribbon.onHandlePointerUp}
            onPointerCancel={ribbon.onHandlePointerCancel}
            className="grid h-11 w-11 place-items-center rounded-ctl border border-line bg-paper text-ink-3 shadow-1 motion-base transition-colors hover:bg-deck touch-none select-none"
          >
            <GripVertical size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
