// Register state — completion, never attendance.
//
// A register records marks out of the distinct people expected. An
// unmarked row is UNKNOWN, not absent; the lane strip and the words
// state completion only. Kept pure so the coach Today, schedule and
// reception check-in surfaces word the same data identically.

export type RegisterState = {
  /** The short state label the row shows. */
  label: "No one enrolled" | "Not started" | "Register open" | "Register complete";
  /** The count, always worded as marks. */
  detail: string;
};

export function registerState(marked: number, total: number): RegisterState {
  const safeMarked = Math.max(0, marked);
  const safeTotal = Math.max(0, total);
  if (safeTotal === 0) {
    return { label: "No one enrolled", detail: "No one enrolled" };
  }
  const capped = Math.min(safeMarked, safeTotal);
  if (capped === 0) {
    return { label: "Not started", detail: `0 / ${safeTotal} marked` };
  }
  if (capped >= safeTotal) {
    return {
      label: "Register complete",
      detail: `${safeTotal} / ${safeTotal} marked`,
    };
  }
  return {
    label: "Register open",
    detail: `${capped} / ${safeTotal} marked`,
  };
}

/** The lane-strip width in whole percent for the same data. */
export function registerProgressPercent(marked: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.min(Math.max(marked, 0), total) / total) * 100);
}
