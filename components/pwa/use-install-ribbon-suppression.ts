"use client";

import { useEffect, useState, type RefObject } from "react";

// When the ribbon must get out of the way.
//
// Three cases, and only three:
//
//   * a modal dialog that is REALLY on screen. A dialog node that is
//     hidden — a closed panel that keeps its markup, a dialog with
//     `hidden` or `display:none`, or a dialog inside a hidden ancestor
//     — is not an open dialog, and the ribbon must not disappear behind
//     it. The check walks the ancestors, because a child's own box can
//     look visible while nothing of it is on the screen;
//   * a styled select — a button or div with `role="combobox"` — with
//     the focus, and the same select while its options are open. The
//     shared Select is owned by another lane; this is only the PWA
//     ribbon's own presentation rule, and it reads the DOM without
//     knowing anything about that component;
//   * an editable field outside the ribbon that has the focus, so the
//     ribbon never covers an active text field or the on-screen
//     keyboard.
//
// The ribbon comes back as soon as the modal closes, is hidden, or the
// field loses the focus. A class or style change on an ancestor can
// hide or reveal a dialog, so those attributes are observed too.

/** A modal dialog, in any of the shapes this app and the platform use. */
const MODAL_SELECTOR = 'dialog[open], [role="dialog"], [aria-modal="true"]';

/** Is this element — and everything it sits in — on the screen? */
function isVisible(element: Element): boolean {
  let node: Element | null = element;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.hasAttribute("hidden")) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    node = node.parentElement;
  }
  return true;
}

/** The modal that is really on screen, if there is one. */
function openModal(): Element | null {
  for (const candidate of Array.from(document.querySelectorAll(MODAL_SELECTOR))) {
    if (isVisible(candidate)) return candidate;
  }
  return null;
}

/**
 * A field the person is working in.
 *
 * A native field is an input, a textarea or a select. The shared Select
 * (owned by another lane) is a button or a div with `role="combobox"`,
 * and it opens a list of options — so it is a field too, and the ribbon
 * must step aside for it exactly as it does for a native one.
 */
function isField(element: HTMLElement): boolean {
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return element.getAttribute("role") === "combobox";
}

/**
 * A styled select whose options are open.
 *
 * The options are on the screen, and they are rendered near the
 * trigger, so the ribbon must not be able to cover them.
 */
function openCombobox(): Element | null {
  for (const candidate of Array.from(document.querySelectorAll('[role="combobox"]'))) {
    if (candidate.getAttribute("aria-expanded") === "true" && isVisible(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function useInstallRibbonSuppression(rootRef: RefObject<HTMLElement | null>): boolean {
  const [suppressed, setSuppressed] = useState(false);

  useEffect(() => {
    const sync = () => {
      const root = rootRef.current;
      const active = document.activeElement;
      const editing =
        active instanceof HTMLElement &&
        isField(active) &&
        !(root !== null && root.contains(active));
      setSuppressed(openModal() !== null || openCombobox() !== null || editing);
    };
    sync();
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // "hidden" and "style" matter: a dialog that is closed by hiding
      // it must release the ribbon again. "class" matters for the same
      // reason: a class-hidden ancestor is a hidden ancestor.
      // "aria-expanded" matters for a styled select: its options open
      // and close with that attribute.
      attributeFilter: [
        "open",
        "aria-modal",
        "aria-expanded",
        "role",
        "hidden",
        "style",
        "class",
      ],
    });
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
      observer.disconnect();
    };
  }, [rootRef]);

  return suppressed;
}
