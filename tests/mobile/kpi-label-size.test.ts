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

  it("the owner dashboard renders three KPI cards through the primitive", () => {
    const src = readFileSync(join(ROOT, DASHBOARD), "utf8");
    const count = (src.match(/<StatCard/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
