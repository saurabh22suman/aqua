// The install ribbon's placement, measured in REAL Chrome.
//
// jsdom has no layout, so the unit suite cannot tell a text rectangle
// from a block wrapper's box. That difference is the whole point of this
// script: in Chrome a range over an element's contents returns the
// DESCENDANT ELEMENTS' boxes as well as the text rectangles (MDN:
// "aggregating the results of calls to Element.getClientRects() for all
// the elements in the range"), so a full-width card or section becomes
// a blocker that spans the page — and the tab has nowhere left to sit.
//
// This script runs the ribbon's OWN measurement and placement code
// (components/pwa/install-ribbon-measure.ts and
// components/pwa/install-ribbon-geometry.ts, transpiled and evaluated
// in the page) against a page shaped like the phone's Members list, and
// reports whether a clear 44px place exists for the tab.
//
// It is NOT a *.test.ts file: it needs a browser, which the Vitest
// suite does not have.
//
// Run it:
//
//   pnpm exec tsx tests/pwa/ribbon-20261030/ribbon-range-chrome.ts
//
// It exits non-zero when the tab has no clear place. That failure is
// the regression this script guards: the tab must be placeable on a
// page whose content sits in a full-width wrapper.
//
// Agent-owned file (tests/pwa/ribbon-20261030/**).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "../../..");
const VIEWPORT = { width: 390, height: 844 };
const TILE = 44;

function transpile(relativePath: string): string {
  const source = readFileSync(resolve(ROOT, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return output;
}

/** The page under test: the phone's members list, in a full-width card. */
const ROWS = Array.from(
  { length: 30 },
  (_, index) =>
    `<li><a href="#r${index}">Member ${index + 1} <span class="badge">Active</span></a></li>`,
).join("");

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px system-ui; background: #EDF0EC; }
  header { position: sticky; top: 0; height: 56px; background: #fff; border-bottom: 1px solid #ccc;
           display: flex; align-items: center; justify-content: flex-end; padding: 0 20px; }
  main { padding: 40px 20px 32px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
  .toolbar select { margin-left: auto; height: 40px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { border-bottom: 1px solid #ddd; }
  li a { display: block; padding: 12px 0; color: #0F1F1C; text-decoration: none; }
  .badge { float: right; background: #DFEEE3; padding: 2px 8px; border-radius: 9999px; font-size: 12px; }
</style></head>
<body>
  <header><button type="button">Theme</button></header>
  <main>
    <section>
      <h1>Members</h1>
      <div class="toolbar"><input aria-label="Search" /><select aria-label="Status"><option>All statuses</option></select></div>
      <ul>${ROWS}</ul>
    </section>
  </main>
</body></html>`;

type Rect = { left: number; top: number; right: number; bottom: number };
type GeometryModule = {
  ribbonBounds: (input: {
    viewportHeight: number;
    ribbonHeight: number;
    headerClearance: number;
    safeAreaBottom: number;
  }) => { minTop: number; maxTop: number };
  ribbonStops: (bounds: { minTop: number; maxTop: number }) => [number, number, number];
  ribbonCandidates: (
    bounds: { minTop: number; maxTop: number },
    preferred: number,
    step?: number,
  ) => number[];
  ribbonClearTop: (
    candidates: number[],
    tabLeft: number,
    tabSize: number,
    blockers: Rect[],
  ) => number | null;
};
type MeasureModule = {
  contentRects: (root: HTMLElement | null) => Rect[];
};

async function main() {
  const geometry = transpile("components/pwa/install-ribbon-geometry.ts");
  const measure = transpile("components/pwa/install-ribbon-measure.ts");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.setContent(PAGE);

  // Evaluate the ribbon's own modules in the page.
  await page.addScriptTag({
    content: `
      window.__aquaModules = {};
      window.require = (name) => window.__aquaModules[name];
      window.__aquaModules["./install-ribbon-geometry"] = (function () {
        const module = { exports: {} };
        const exports = module.exports;
        ${geometry}
        return module.exports;
      })();
      window.__aquaModules["./install-ribbon-measure"] = (function () {
        const module = { exports: {} };
        const exports = module.exports;
        ${measure}
        return module.exports;
      })();
    `,
  });

  const result = await page.evaluate(
    ({ tile }) => {
      const modules = (
        window as unknown as { require: (name: string) => unknown }
      ).require;
      const geometryModule = modules(
        "./install-ribbon-geometry",
      ) as GeometryModule;
      const measureModule = modules("./install-ribbon-measure") as MeasureModule;
      const blockers = measureModule.contentRects(null);
      const band = geometryModule.ribbonBounds({
        viewportHeight: window.innerHeight,
        ribbonHeight: tile,
        headerClearance: 56,
        safeAreaBottom: 0,
      });
      const preferred = geometryModule.ribbonStops(band)[1];
      const candidates = geometryModule.ribbonCandidates(band, preferred);
      const clear = geometryModule.ribbonClearTop(
        candidates,
        window.innerWidth - tile,
        tile,
        blockers,
      );
      return {
        blockers: blockers.length,
        candidates: candidates.length,
        clear,
        widest: blockers.reduce(
          (max: number, rect: Rect) => {
            const width = rect.right - rect.left;
            return width > max ? width : max;
          },
          0,
        ),
      };
    },
    { tile: TILE },
  );

  await browser.close();

  console.log(
    `    measured: blockers=${result.blockers} candidates=${result.candidates} ` +
      `widestBlocker=${result.widest}px clearTop=${result.clear}`,
  );
  if (result.clear === null) {
    console.log(
      "\n✗ The install tab has NO clear 44px place on a members-shaped page.\n" +
        "  The tab would cover a row, so the ribbon cannot be placed at all.",
    );
    process.exit(1);
  }
  console.log(`\n✓ A clear 44px place exists (top ${result.clear}px).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
