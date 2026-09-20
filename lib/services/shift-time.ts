import { z } from "zod";

// V-23 — wall-time parsing shared by the shift services. "6:00" and
// "06:00:00" both normalise to "06:00" so comparisons and inserts are
// stable regardless of what the form or a template row carried.

export const wallTime = z
  .string()
  .regex(/^\d{1,2}:\d{2}(:\d{2})?$/, "Use a HH:MM time.");

export function normalizeWall(value: string): string {
  const [hours = "0", minutes = "0"] = value.split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}
