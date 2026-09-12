import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 5 (mobile UX plan v2) — F36. The three owner-dashboard KPI
// labels were 11px, below the 12px meta floor in DESIGN.md and hard to
// read in sunlight. Phase 5 raises them to 13px (label/meta band).
// Source scan because no test renders OwnerDashboard.

const ROOT = process.cwd();
const FILE = "components/owner-dashboard.tsx";

describe("owner dashboard KPI labels (F36)", () => {
  it("has no text-[11px] labels left", () => {
    const src = readFileSync(join(ROOT, FILE), "utf8");
    const hits = src.split("\n").filter((l) => l.includes("text-[11px]"));
    expect(hits, `11px labels remain:\n${hits.join("\n")}`).toEqual([]);
  });

  it("renders the three KPI labels at 13px", () => {
    const src = readFileSync(join(ROOT, FILE), "utf8");
    const count = (src.match(/text-\[13px\] text-ink-3/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
