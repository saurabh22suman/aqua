import { queueCount } from "./idb";

// What an update must not throw away.
//
// Two kinds of pending work exist in this app (docs/design-system/pwa.md):
//   * attendance marks waiting in the offline queue, and
//   * anything the person has typed but not saved.
//
// A reload that loses either is data loss, so the update is offered, not
// applied: the person decides, and the decision is only honoured when
// nothing is pending.

export type PendingWork = {
  /** Attendance marks waiting to sync. -1 means "could not be read". */
  pendingAttendance: number;
  /** Form fields that still hold unsaved content. */
  unsavedInputs: number;
};

const TEXT_INPUT_TYPES = new Set([
  "text",
  "email",
  "number",
  "search",
  "tel",
  "url",
  "password",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/**
 * How many controls on the page hold content the server has not been
 * told about.
 *
 * A control counts as unsaved when its current value differs from the
 * state the server rendered: text fields with content, checkboxes and
 * radios flipped away from `defaultChecked`, selects moved away from
 * the option the server marked, and editable regions with text.
 *
 * `data-pwa-dirty="false"` opts a control out — a search box that is
 * safe to lose, for example.
 */
export function unsavedInputCount(doc: Document = document): number {
  let count = 0;
  const controls = doc.querySelectorAll("input, textarea, select, [contenteditable]");
  for (const element of Array.from(controls)) {
    if (element.getAttribute("data-pwa-dirty") === "false") continue;
    if (element instanceof HTMLInputElement) {
      if (element.type === "hidden") continue;
      if (element.type === "checkbox" || element.type === "radio") {
        if (element.checked !== element.defaultChecked) count++;
        continue;
      }
      if (!TEXT_INPUT_TYPES.has(element.type)) continue;
      if (element.value.trim() !== "") count++;
      continue;
    }
    if (element instanceof HTMLTextAreaElement) {
      if (element.value.trim() !== "") count++;
      continue;
    }
    if (element instanceof HTMLSelectElement) {
      const options = Array.from(element.options);
      if (!options.length) continue;
      // The state the server rendered is the option carrying the
      // `selected` attribute, or the first option when none does.
      const renderedIndex = options.findIndex(option => option.defaultSelected);
      const rendered = renderedIndex >= 0 ? renderedIndex : 0;
      if (element.value !== (options[rendered]?.value ?? "")) count++;
      continue;
    }
    if (element.getAttribute("contenteditable") === "false") continue;
    if ((element.textContent ?? "").trim() !== "") count++;
  }
  return count;
}

/**
 * Attendance marks still queued for the active identity. -1 when the
 * store could not be read: an unreadable queue is never an empty queue.
 */
export async function pendingAttendanceCount(): Promise<number> {
  try {
    const count = await queueCount();
    return Number.isSafeInteger(count) && count >= 0 ? count : -1;
  } catch {
    return -1;
  }
}

/** Everything that would be lost by a reload right now. */
export async function pendingOfflineWork(): Promise<PendingWork> {
  return { pendingAttendance: await pendingAttendanceCount(), unsavedInputs: unsavedInputCount() };
}

/** Is it safe to reload the page? */
export function isSafeToReload(work: PendingWork): boolean {
  return work.pendingAttendance === 0 && work.unsavedInputs === 0;
}

/** The sentence shown when an update is refused. */
export function pendingWorkMessage(work: PendingWork): string {
  if (work.pendingAttendance > 0) {
    const marks = `${work.pendingAttendance} attendance ${work.pendingAttendance === 1 ? "mark" : "marks"}`;
    return `${marks} waiting to sync. Update once they have synced.`;
  }
  if (work.pendingAttendance === -1) {
    return "This device could not confirm your saved attendance. Reconnect before updating.";
  }
  if (work.unsavedInputs > 0) {
    return "You have unsaved changes on this page. Save them, then update.";
  }
  return "Something is still pending. Try again in a moment.";
}
