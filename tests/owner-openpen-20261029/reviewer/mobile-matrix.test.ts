import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MATRIX = join(
  ROOT,
  "docs/design/owner-openpen-20261029/mobile-20261029/mobile-matrix.json",
);
const FINAL = join(
  ROOT,
  "docs/design/owner-openpen-20261029/qa/final-matrix.json",
);

type SourceReady = { sha256: string; at: string } | null;

type Matrix = {
  status: string;
  sourceReady: SourceReady;
  widths: number[];
  sharedRoutes: Array<{ route: string }>;
  cases: Array<{
    id: string;
    assertions: string[];
    status: string;
    themes: string[];
    widths: number[];
  }>;
  deviceChecklist: Array<{ id: string; status: string; reason?: string }>;
  layers: Record<string, unknown>;
};

type FinalMatrix = {
  sourceReady: SourceReady;
};

function load(): Matrix {
  return JSON.parse(readFileSync(MATRIX, "utf8")) as Matrix;
}

function loadFinal(): FinalMatrix {
  return JSON.parse(readFileSync(FINAL, "utf8")) as FinalMatrix;
}

describe("mobile QA preparation matrix", () => {
  it("accepts only prepared/no-source or a valid matching SOURCE_READY record", () => {
    const matrix = load();
    const final = loadFinal();
    expect(matrix.status).toBe("prepared");
    expect(matrix.widths).toEqual(
      expect.arrayContaining([320, 360, 375, 390, 412, 430, 480]),
    );

    const ready = matrix.sourceReady;
    const finalReady = final.sourceReady;
    if (ready === null || finalReady === null) {
      // Prepared state: both matrices must be null, never one-sided.
      expect(ready).toBeNull();
      expect(finalReady).toBeNull();
      return;
    }

    // Admitted state: identical valid SHA-256 + timestamp in both matrices.
    expect(ready).toEqual(finalReady);
    expect(ready.sha256).toMatch(/^[0-9a-f]{64}$/i);
    expect(ready.at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
    );
    expect(Number.isNaN(Date.parse(ready.at))).toBe(false);
  });

  it("covers the shared component families without a full cartesian product", () => {
    const matrix = load();
    const routes = matrix.sharedRoutes.map((entry) => entry.route);
    expect(routes).toEqual(
      expect.arrayContaining([
        "/owner",
        "/owner/members",
        "/owner/members/{memberId}",
        "/owner/fees?tab=dues",
        "/owner/bookings",
        "/owner/reports",
        "/owner/settings",
      ]),
    );
    expect(matrix.layers.sharedFamilies).toBeTruthy();
  });

  it("keeps every case typed with assertions, themes, widths and honest status", () => {
    const matrix = load();
    expect(matrix.cases.length).toBeGreaterThanOrEqual(12);
    for (const entry of matrix.cases) {
      expect(entry.id).toMatch(/^MOB-\d{2}$/);
      expect(entry.assertions.length).toBeGreaterThan(0);
      expect(entry.themes.length).toBeGreaterThan(0);
      expect(entry.widths.length).toBeGreaterThan(0);
      expect(["PREPARED", "NOT TESTED", "BLOCKED"]).toContain(entry.status);
    }
    expect(matrix.cases.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "MOB-01",
        "MOB-02",
        "MOB-03",
        "MOB-04",
        "MOB-05",
        "MOB-06",
        "MOB-07",
        "MOB-08",
        "MOB-09",
        "MOB-10",
        "MOB-11",
        "MOB-12",
      ]),
    );
  });

  it("reuses the full 49-view / 40-route inventory", () => {
    const matrix = load();
    const finalMatrix = JSON.parse(readFileSync(FINAL, "utf8")) as {
      views: unknown[];
    };
    expect(matrix.layers.fullRoutes).toBeTruthy();
    expect(matrix.layers.fullRoutes).toMatchObject({
      reference: "docs/design/owner-openpen-20261029/qa/final-matrix.json",
      referenceViews: 49,
      realRoutes: 40,
    });
    expect(Array.isArray(finalMatrix.views)).toBe(true);
    expect(finalMatrix.views.length).toBe(49);
  });

  it("keeps physical/zoom/AT evidence explicitly not tested", () => {
    const matrix = load();
    const ids = matrix.deviceChecklist.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "xiaomi-chrome",
        "installed-pwa-keyboard",
        "browser-zoom-200",
        "browser-zoom-400",
        "text-spacing-200",
        "talkback",
        "voiceover",
        "physical-keyboard",
      ]),
    );
    for (const entry of matrix.deviceChecklist) {
      expect(["NOT TESTED", "BLOCKED"]).toContain(entry.status);
      expect(entry.reason?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
