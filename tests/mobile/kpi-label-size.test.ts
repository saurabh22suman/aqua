import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 5 (mobile UX plan v2) — F36. The three owner-dashboard KPI
// labels were 11px, below the 12px meta floor in DESIGN.md and hard to
// read in sunlight. Phase 5 raises them to 13px (label/meta band).
// Source scan because no test renders OwnerDashboard. PR3-C2 moved
// the KPI tiles into components/ui/StatCard.tsx; the guard follows the
// labels to their new home so the 13px floor still has one owner.

const ROOT = process.cwd();
const FILE = "components/ui/StatCard.tsx";
const DASHBOARD = "components/owner-dashboard.tsx";
// Owner OpenPen (29 October 2026): Home now leads with one unified money
// surface rather than four tiles. Its primary KPI label keeps the same
// 13px floor; the action lives inside that surface. Follow the current
// owner of the label, not the retired metrics row.
const HOME_MONEY = "components/owner-home/owner-home-money.tsx";

describe("owner dashboard KPI labels (F36)", () => {
  it("has no text-[11px] labels left", () => {
    const src = readFileSync(join(ROOT, FILE), "utf8");
    const hits = src.split("\n").filter((l) => l.includes("text-[11px]"));
    expect(hits, `11px labels remain:\n${hits.join("\n")}`).toEqual([]);
  });

  it("renders the KPI label at 13px in the shared primitive", () => {
    const src = readFileSync(join(ROOT, FILE), "utf8");
    const count = (src.match(/text-\[13px\][^"\n]*text-ink-3/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("the owner Home renders its real KPI labels through the unified money surface", () => {
    const dashboard = readFileSync(join(ROOT, DASHBOARD), "utf8");
    const money = readFileSync(join(ROOT, HOME_MONEY), "utf8");
    // The current surface owns the labels and the action inside it.
    expect(dashboard).toContain("<OwnerHomeMoney");
    expect(dashboard).not.toContain("<OwnerHomeMetrics");
    expect(money).toContain("<OwnerHomeActions");
    expect(money).toContain("Collected today");
    expect(money).toContain("Outstanding now");
    expect(money).toContain("Overdue now");
    // The KPI label stays at/above the 13px readable floor.
    expect(money).toMatch(/text-\[13px\][^"\n]*text-ink-2/);
  });
});
