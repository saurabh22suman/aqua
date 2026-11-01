// The shared DateField's calendar — a DISCOVERY probe.
//
// The calendar popup does not exist yet, so this file cannot import it.
// It finds the calendar the way a user does: the control that opens it,
// the days it shows, and the day the keyboard is on.
//
// Every helper is deliberately tolerant about STRUCTURE (a dialog, a
// grid, a listbox, a plain table) and strict about OUTCOMES, so the
// contract can be met by any reasonable calendar rather than by one
// exact markup. Nothing here asserts product behaviour; the test files
// own the assertions.

/** The control that opens the calendar. */
export function calendarTrigger(root: ParentNode): HTMLElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      "button, [role='button'], input[type='button']",
    ),
  );
  return (
    candidates.find((el) => {
      const popup = el.getAttribute("aria-haspopup");
      if (popup === "dialog" || popup === "grid" || popup === "listbox") return true;
      const label = `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`;
      return (
        /calendar|choose|open|pick|select/i.test(label) &&
        /date|calendar/i.test(label)
      );
    }) ?? null
  );
}

/** The day cells the calendar shows. */
export function dayCells(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      "button, [role='gridcell'], [role='option'], td",
    ),
  ).filter((el) => {
    // A cell that WRAPS another cell is a container, not a day.
    if (el.querySelector("button, [role='gridcell'], [role='option']")) return false;
    return /^\d{1,2}$/.test((el.textContent ?? "").trim());
  });
}

/** The day cell for the given day of the month, if the calendar shows it. */
export function dayCell(root: ParentNode, day: number): HTMLElement | null {
  return (
    dayCells(root).find(
      (el) => (el.textContent ?? "").trim() === String(day),
    ) ?? null
  );
}

/**
 * The day the keyboard is on, however the calendar tracks it: a focused
 * day cell, or the cell a container points at with aria-activedescendant.
 */
export function focusedDay(): string | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return null;
  const direct = (active.textContent ?? "").trim();
  if (/^\d{1,2}$/.test(direct) && dayCells(document.body).includes(active)) {
    return direct;
  }
  const referenced = active.getAttribute("aria-activedescendant");
  if (referenced) {
    const text = (document.getElementById(referenced)?.textContent ?? "").trim();
    if (/^\d{1,2}$/.test(text)) return text;
  }
  return null;
}
