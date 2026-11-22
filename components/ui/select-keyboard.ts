// UI foundation — the keyboard model of an open select popup.
//
// The popup is a listbox with one option highlighted: the arrow keys
// walk it, Home and End jump to its ends, Enter and Space choose the
// highlighted option, Escape closes it, and typing moves to the option
// that starts with what was typed.
//
// The decisions here are pure — a key and the state in, an action out —
// so the popup's keyboard behaviour can be read (and tested) without a
// browser.

import type { SelectOption } from "./select-options";

export type PopupKeyAction =
  /** Close the popup. `swallow` means the key must not reach the page. */
  | { kind: "close"; swallow: boolean }
  /** Move the highlight. */
  | { kind: "move"; direction: 1 | -1 }
  /** Jump to the first or the last option that can be chosen. */
  | { kind: "edge"; edge: "first" | "last" }
  /** Choose the highlighted option. */
  | { kind: "choose" }
  /** Move to the option that starts with the typed character. */
  | { kind: "typeahead"; character: string };

/**
 * What a key means while the popup is open.
 *
 * `null` means the key is not the popup's: the page may still want it.
 */
export function popupKeyAction(key: string): PopupKeyAction | null {
  switch (key) {
    case "Escape":
      // The popup is the first layer: Escape closes it and goes no
      // further, so an enclosing dialog does not close with it.
      return { kind: "close", swallow: true };
    case "Tab":
      // The browser keeps its own tab order: the popup is never a
      // focus trap, and the key goes on to the page.
      return { kind: "close", swallow: false };
    case "Enter":
    case " ":
      return { kind: "choose" };
    case "ArrowDown":
      return { kind: "move", direction: 1 };
    case "ArrowUp":
      return { kind: "move", direction: -1 };
    case "Home":
      return { kind: "edge", edge: "first" };
    case "End":
      return { kind: "edge", edge: "last" };
    default:
      return key.length === 1 ? { kind: "typeahead", character: key } : null;
  }
}

/** The indexes of the options that can be chosen, in order. */
export function enabledIndexes(options: SelectOption[]): number[] {
  const indexes: number[] = [];
  options.forEach((option, index) => {
    if (!option.disabled) indexes.push(index);
  });
  return indexes;
}

/**
 * The next option that can be chosen, walking in one direction and
 * wrapping round. A disabled option is skipped, never highlighted.
 */
export function nextEnabledIndex(
  options: SelectOption[],
  from: number,
  direction: 1 | -1,
): number {
  if (options.length === 0) return -1;
  let index = from;
  for (let step = 0; step < options.length; step += 1) {
    index = (index + direction + options.length) % options.length;
    const option = options[index];
    if (option && !option.disabled) return index;
  }
  return -1;
}

/**
 * The prefix a typed character makes.
 *
 * Typing a letter EXTENDS the prefix ("c" then "o" is "co"), so the
 * typeahead can reach an option that starts with more than one letter.
 * Typing the SAME letter again starts the prefix again, so the typeahead
 * walks to the next option that starts with it. A pause starts it again
 * too.
 */
export function typeaheadPrefix(
  previous: { text: string; at: number },
  character: string,
  now: number,
  resetAfterMs: number,
): string {
  if (previous.text.length === 0) return character;
  if (now - previous.at > resetAfterMs) return character;
  const repeated = previous.text
    .split("")
    .every((letter) => letter === previous.text[0]);
  if (repeated && previous.text[0] === character) return character;
  return previous.text + character;
}

/**
 * The option that starts with the typed characters.
 *
 * The search starts at the option after the highlight and wraps round,
 * so typing the same letter again walks to the next option that starts
 * with it. A disabled option is never a match.
 */
export function matchByPrefix(
  options: SelectOption[],
  prefix: string,
  from: number,
): number {
  const needle = prefix.toLowerCase();
  const start = from >= 0 ? from : -1;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (start + step) % options.length;
    const option = options[index];
    if (!option || option.disabled) continue;
    if (option.label.toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}
