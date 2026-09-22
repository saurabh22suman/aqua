import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAYMENT_STATUS_TONE,
  PLAN_STATUS_TONE,
  SESSION_STATUS_TONE,
  TONE_SURFACE_CLASS,
} from "@/components/ui/StatusBadge";
import { buttonClasses } from "@/components/ui/Button";

// PR3-C1 — the contrast contract. The 2026-09-21 audit measured
// white-on-mango at 2.61:1 and ink-3-on-deck at 2.91:1: both below
// WCAG AA for the text they carry. This pins the fixed tokens and the
// tone maps the redesign needs, computed from the real CSS values.

const GLOBALS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

function cssValue(name: string): string {
  const match = GLOBALS.match(
    new RegExp(`${name.replace("--", "\\-\\-")}:\\s*(#[0-9A-Fa-f]{6})`),
  );
  if (!match) throw new Error(`token ${name} not found in globals.css`);
  return match[1]!.toUpperCase();
}

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe("token contrast (PR3-C1)", () => {
  it("primary action: white text on --accent-strong meets AA", () => {
    const strong = cssValue("--accent-strong");
    expect(contrast("#FFFFFF", strong)).toBeGreaterThanOrEqual(4.5);
  });

  it("muted text: ink-3 meets AA on deck and paper", () => {
    const ink3 = cssValue("--color-ink-3");
    expect(contrast(ink3, cssValue("--color-deck"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink3, cssValue("--color-paper"))).toBeGreaterThanOrEqual(4.5);
  });

  it("secondary text and body: ink-2 and ink meet AA on deck and paper", () => {
    const ink2 = cssValue("--color-ink-2");
    const ink = cssValue("--color-ink");
    for (const surface of ["--color-deck", "--color-paper"]) {
      expect(contrast(ink2, cssValue(surface))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ink, cssValue(surface))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("status tones meet AA on their soft surfaces", () => {
    expect(
      contrast(cssValue("--color-good"), cssValue("--color-good-soft")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(cssValue("--color-warn"), cssValue("--color-warn-soft")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(cssValue("--color-late"), cssValue("--color-late-soft")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("primary Button uses the strong accent, never the action accent as a surface", () => {
    const classes = buttonClasses({ variant: "primary" });
    expect(classes).toContain("var(--accent-strong)");
    expect(classes).not.toContain("var(--accent)");
  });
});

describe("status tone maps (PR3-C1)", () => {
  it("maps every session status to a tone", () => {
    expect(Object.keys(SESSION_STATUS_TONE).sort()).toEqual([
      "cancelled",
      "completed",
      "in_progress",
      "scheduled",
    ]);
  });

  it("maps every payment status to a tone", () => {
    expect(Object.keys(PAYMENT_STATUS_TONE).sort()).toEqual([
      "captured",
      "failed",
      "pending",
      "refunded",
    ]);
    expect(PAYMENT_STATUS_TONE.captured).toBe("good");
    expect(PAYMENT_STATUS_TONE.refunded).toBe("neutral");
  });

  it("maps every subscription/plan status to a tone", () => {
    expect(Object.keys(PLAN_STATUS_TONE).sort()).toEqual([
      "active",
      "cancelled",
      "expired",
      "paused",
    ]);
  });

  it("every tone used by the maps is a real tone with a surface class", () => {
    for (const tone of [
      ...Object.values(SESSION_STATUS_TONE),
      ...Object.values(PAYMENT_STATUS_TONE),
      ...Object.values(PLAN_STATUS_TONE),
    ]) {
      expect(TONE_SURFACE_CLASS[tone]).toBeTruthy();
    }
  });
});
