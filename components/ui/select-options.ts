// UI foundation — the options of a shared select.
//
// The shared control keeps the real `<select>` and its real `<option>`
// children: the native options ARE the options. The popup therefore
// reads them from the DOM instead of keeping a second copy, so an
// option that arrives later (an async list) or an option that is
// disabled at runtime is always the one the popup shows.
//
// Reading the DOM is deliberate: the popup must never disagree with
// the control that owns the value.

export type SelectOption = {
  /** The value the control takes when this option is chosen. */
  value: string;
  /** The text the reader sees. */
  label: string;
  /** A disabled option cannot be chosen. */
  disabled: boolean;
  /** The option the control currently holds. */
  selected: boolean;
  /** The group the option belongs to, when the control has one. */
  group: string | null;
};

/** The group an option sits in, when it sits in one. */
function groupOf(option: HTMLOptionElement): HTMLOptGroupElement | null {
  const parent = option.parentElement;
  return parent instanceof HTMLOptGroupElement ? parent : null;
}

/**
 * Every option of the control, in the control's own order.
 *
 * An option inside a disabled group is disabled too: the group's state
 * is the browser's rule, and the popup has to keep it.
 */
export function readSelectOptions(select: HTMLSelectElement | null): SelectOption[] {
  if (!select) return [];
  const list: SelectOption[] = [];
  for (let index = 0; index < select.options.length; index += 1) {
    const option = select.options.item(index);
    if (!option) continue;
    const group = groupOf(option);
    list.push({
      value: option.value,
      label: option.label || option.text,
      disabled: option.disabled || Boolean(group?.disabled),
      selected: option.selected,
      group: group ? group.label || group.getAttribute("label") || null : null,
    });
  }
  return list;
}

/**
 * The name the control answers to.
 *
 * The popup is the control's own listbox, so it is named after the
 * control: the control's own label, or the name the control was given.
 */
export function readControlName(
  select: HTMLSelectElement | null,
  ariaLabel?: string,
): string {
  if (ariaLabel) return ariaLabel;
  const id = select?.id;
  if (id) {
    for (const label of Array.from(
      document.querySelectorAll<HTMLLabelElement>("label[for]"),
    )) {
      if (label.htmlFor !== id) continue;
      const text = label.textContent?.trim();
      if (text) return text;
    }
  }
  return select?.getAttribute("name") || "Select";
}

/**
 * A cheap fingerprint of a list of options.
 *
 * The popup re-reads the control's options after every render, so it
 * needs to know whether anything actually changed: without this, every
 * render would schedule another one.
 */
export function optionsSignature(options: SelectOption[]): string {
  return options
    .map(
      (option) =>
        `${option.value}${option.label}${option.disabled ? 1 : 0}${
          option.selected ? 1 : 0
        }${option.group ?? ""}`,
    )
    .join("");
}
