#!/usr/bin/env tsx
/**
 * Compose same-viewport APP vs exact-reference side-by-side evidence.
 *
 * Inputs must already exist:
 *   APP:       .playwright-mcp/owner-openpen-final/routes/<theme>/<viewport>/<view>.png
 *   REFERENCE: .playwright-mcp/reference-render/<desktop|phone>/<theme>/<view>.png
 *
 * No app server, build or mutation. This script only composes already-rendered
 * PNGs and records which pairs are available. It never claims a visual PASS.
 *
 * Run through lane_job.py:
 *   AQUA_E2E_OUT=.playwright-mcp/owner-openpen-compare \
 *   node --experimental-strip-types tests/owner-openpen-20261029/reviewer/compare-reference.ts \
 *     --theme lavender --viewport desktop-1280x900
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT_DIR = resolve(
  ROOT,
  process.env.AQUA_E2E_OUT ?? ".playwright-mcp/owner-openpen-compare",
);
const APP_ROOT = resolve(
  ROOT,
  process.env.AQUA_APP_EVIDENCE ?? ".playwright-mcp/owner-openpen-final",
);
const REFERENCE_ROOT = resolve(
  ROOT,
  process.env.AQUA_REFERENCE_EVIDENCE ?? ".playwright-mcp/reference-render",
);
const FINAL_MATRIX = join(
  ROOT,
  "docs/design/owner-openpen-20261029/qa/final-matrix.json",
);

const THEMES = ["mint", "lavender"] as const;
type Theme = (typeof THEMES)[number];
type ViewportName = "desktop-1280x900" | "mobile-390x844";
const VIEWPORTS: Record<
  ViewportName,
  { name: ViewportName; width: number; height: number; layout: "desktop" | "phone" }
> = {
  "desktop-1280x900": {
    name: "desktop-1280x900",
    width: 1280,
    height: 900,
    layout: "desktop",
  },
  "mobile-390x844": {
    name: "mobile-390x844",
    width: 390,
    height: 844,
    layout: "phone",
  },
};

type FinalMatrix = {
  views: Array<{ viewId: string; referenceIds: string[] }>;
};

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("comparison input is not a PNG");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const theme = (argValue(args, "--theme") ?? "lavender") as Theme;
  const viewportName = (argValue(args, "--viewport") ??
    "desktop-1280x900") as ViewportName;
  if (!THEMES.includes(theme)) throw new Error(`unknown theme ${theme}`);
  const viewport = VIEWPORTS[viewportName];
  if (!viewport) throw new Error(`unknown viewport ${viewportName}`);
  if (!relative(ROOT, OUT_DIR).startsWith(".playwright-mcp")) {
    throw new Error("Comparison evidence must stay under ignored .playwright-mcp/");
  }
  const matrix = JSON.parse(await readFile(FINAL_MATRIX, "utf8")) as FinalMatrix;
  const records: Array<Record<string, unknown>> = [];
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: viewport.width * 2 + 36, height: viewport.height + 84 },
    deviceScaleFactor: 1,
    locale: "en-IN",
  });
  try {
    for (const view of matrix.views) {
      const referenceId = view.referenceIds[0] ?? view.viewId;
      const appPath = join(
        APP_ROOT,
        "routes",
        theme,
        viewport.name,
        `${view.viewId}.png`,
      );
      const referencePath = join(
        REFERENCE_ROOT,
        viewport.layout,
        theme,
        `${referenceId}.png`,
      );
      const outPath = join(
        OUT_DIR,
        viewport.layout,
        theme,
        `${view.viewId}.png`,
      );
      process.stdout.write(
        `compare ${theme}/${viewport.name}/${view.viewId} … `,
      );
      try {
        const [appBytes, referenceBytes] = await Promise.all([
          readFile(appPath),
          readFile(referencePath),
        ]);
        const appSize = pngSize(appBytes);
        const referenceSize = pngSize(referenceBytes);
        const appData = appBytes.toString("base64");
        const referenceData = referenceBytes.toString("base64");
        const width = Math.max(appSize.width, referenceSize.width);
        const height = Math.max(appSize.height, referenceSize.height);
        await page.setViewportSize({
          width: width * 2 + 36,
          height: height + 84,
        });
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"><style>
            html,body{margin:0;background:#f7f7f8;color:#1d1b20;font:13px/1.4 system-ui,sans-serif}
            .caption{display:flex;justify-content:space-between;align-items:baseline;padding:12px 18px 6px}
            .caption strong{font-size:15px}
            .caption span{color:#5b5563}
            .row{display:grid;grid-template-columns:${width}px ${width}px;gap:36px;padding:0 18px 18px}
            figure{margin:0;min-width:0}
            figcaption{font-weight:600;padding:0 0 6px}
            img{display:block;width:${width}px;height:${height}px;object-fit:contain;background:#fff;border:1px solid #d7d2db}
          </style></head><body>
            <div class="caption"><strong>Same-viewport comparison · ${theme} · ${viewport.name}</strong><span>${view.viewId} · reference ${referenceId}</span></div>
            <div class="row">
              <figure><figcaption>APP (real synthetic data)</figcaption><img alt="app ${view.viewId}" src="data:image/png;base64,${appData}"></figure>
              <figure><figcaption>REFERENCE (illustrative data; composition only)</figcaption><img alt="reference ${referenceId}" src="data:image/png;base64,${referenceData}"></figure>
            </div>
          </body></html>`,
          { waitUntil: "load" },
        );
        await page.waitForTimeout(120);
        await mkdir(dirname(outPath), { recursive: true });
        await page.screenshot({
          path: outPath,
          fullPage: false,
          animations: "disabled",
          caret: "hide",
        });
        const outBytes = await readFile(outPath);
        records.push({
          viewId: view.viewId,
          referenceId,
          theme,
          viewport: viewport.name,
          app: relative(ROOT, appPath),
          reference: relative(ROOT, referencePath),
          comparison: relative(ROOT, outPath),
          size: pngSize(outBytes),
          bytes: outBytes.length,
          status: "CAPTURED",
        });
        console.log("captured");
      } catch (error) {
        records.push({
          viewId: view.viewId,
          referenceId,
          theme,
          viewport: viewport.name,
          app: relative(ROOT, appPath),
          reference: relative(ROOT, referencePath),
          status: "BLOCKED",
          error: String(error).slice(0, 600),
        });
        console.log("blocked");
      }
    }
    const summary = {
      script: "compare-reference",
      status: records.some((record) => record.status === "BLOCKED")
        ? "PARTIAL"
        : "CAPTURED",
      capturedAt: new Date().toISOString(),
      appRoot: relative(ROOT, APP_ROOT),
      referenceRoot: relative(ROOT, REFERENCE_ROOT),
      theme,
      viewport,
      records,
      note:
        "Side-by-side evidence only. visualReviewed remains false until an independent reviewer records a verdict. Reference amounts/identities are illustrative and are not pass criteria.",
    };
    await mkdir(OUT_DIR, { recursive: true });
    const body = JSON.stringify(summary, null, 2) + "\n";
    await Promise.all([
      writeFile(join(OUT_DIR, "summary.json"), body),
      writeFile(
        join(
          OUT_DIR,
          `summary-${viewport.layout}-${theme}.json`,
        ),
        body,
      ),
    ]);
    console.log(
      `compare: ${records.filter((record) => record.status === "CAPTURED").length}/${records.length} captured`,
    );
    return summary.status === "CAPTURED" ? 0 : 1;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`COMPARE STOP: ${String(error).slice(0, 1200)}`);
    process.exitCode = 1;
  });
