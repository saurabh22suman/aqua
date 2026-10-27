// UI foundation — the accessible name of a Menu trigger.
//
// The trigger is a button the caller fills with content: a word, an
// icon, a word and an icon. The button must still have a name, and
// the name the caller put there must survive.

import { isValidElement, type ReactNode } from "react";

/**
 * Does the trigger content already name the button? Text, an
 * aria-label, an aria-labelledby or a title all name it; an
 * aria-hidden subtree names nothing. A name the caller put there is
 * kept — the button never overwrites a visible label with its own
 * (WCAG 2.5.3).
 */
export function carriesOwnName(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === "boolean") return false;
  if (typeof node === "string") return node.trim().length > 0;
  if (typeof node === "number") return true;
  if (Array.isArray(node)) return node.some(carriesOwnName);
  if (!isValidElement(node)) return false;
  const props = node.props as Record<string, unknown> & { children?: ReactNode };
  if (props["aria-hidden"] === true || props["aria-hidden"] === "true") return false;
  const named = ["aria-label", "aria-labelledby", "title"].some((name) => {
    const value = props[name];
    return typeof value === "string" && value.trim().length > 0;
  });
  return named || carriesOwnName(props.children);
}

/**
 * The accessible name of the trigger button.
 *
 * `triggerLabel` names the button outright. Otherwise the name the
 * trigger content carries wins, and an icon-only trigger falls back to
 * the menu's own label so the button is never nameless.
 */
export function resolveTriggerName({
  label,
  triggerLabel,
  trigger,
}: {
  label: string;
  triggerLabel?: string;
  trigger: ReactNode;
}): string | undefined {
  if (triggerLabel) return triggerLabel;
  return carriesOwnName(trigger) ? undefined : label;
}
