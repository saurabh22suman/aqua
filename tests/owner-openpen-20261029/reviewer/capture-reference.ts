#!/usr/bin/env tsx
/**
 * Render the exact local OpenPen reference HTML through its OWN UI controls
 * in isolated Google Chrome. This is reference/input capture only: no app
 * preview, no build and no baseline rerun.
 *
 * The outer review harness (page/theme/layout/state selects, caption and
 * rationale) is hidden for the screenshot, but the prototype frame itself is
 * never scaled or given invented content. The frame's rendered dimensions,
 * viewport, selected control values and reference hash are recorded in the
 * manifest.
 *
 * Run through lane_job.py:
 *   AQUA_E2E_OUT=.playwright-mcp/reference-render \
 *   node --experimental-strip-types tests/owner-openpen-20261029/reviewer/capture-reference.ts --all
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";

const ROOT = process.cwd();
const OUT_DIR = resolve(
  ROOT,
  process.env.AQUA_E2E_OUT ?? ".playwright-mcp/reference-render",
);
const REFERENCE = join(
  ROOT,
  "docs/design/owner-openpen-20261029/reference/openpen-owner-design-review.html",
);

const THEMES = ["mint", "lavender"] as const;
type Theme = (typeof THEMES)[number];
type ViewportName = "desktop-1280x900" | "mobile-390x844";
type Layout = "desktop" | "phone";
type Viewport = {
  name: ViewportName;
  layout: Layout;
  width: number;
  height: number;
};

const VIEWPORTS: Record<ViewportName, Viewport> = {
  "desktop-1280x900": {
    name: "desktop-1280x900",
    layout: "desktop",
    width: 1280,
    height: 900,
  },
  "mobile-390x844": {
    name: "mobile-390x844",
    layout: "phone",
    width: 390,
    height: 844,
  },
};

/** The coordinator-requested visual inputs; invoice is kept because Dues/
 * Invoices is a pair and the selected-invoice reference is a distinct view. */
const DEFAULT_VIEWS = [
  "home",
  "members",
  "fees",
  "fees-invoices",
  "invoice",
  "bookings",
  "settings",
] as const;

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("reference capture did not produce a PNG");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

type FrameCapture = {
  id: string;
  viewId: string;
  theme: Theme;
  viewport: ViewportName;
  layout: Layout;
  state: "populated";
  controls: {
    page: string;
    theme: string;
    layout: string;
    state: string;
  };
  screenshot: string;
  screenshotSize: { width: number; height: number };
  screenshotBytes: number;
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    scrollWidth: number;
    clientWidth: number;
    documentScrollHeight: number;
    transform: string;
    deviceScaleFactor: number;
  };
  text: {
    title: string;
    crumb: string;
    heading: string;
    note: string;
  };
};

async function renderOne(
  page: Page,
  viewId: string,
  theme: Theme,
  viewport: Viewport,
): Promise<FrameCapture> {
  const screenshot = join(
    OUT_DIR,
    viewport.layout,
    theme,
    `${viewId}.png`,
  );
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(pathToFileURL(REFERENCE).href, {
    waitUntil: "load",
    timeout: 60_000,
  });
  const options = await page.locator("#ks-page option").count();
  if (options < 40) {
    throw new Error(`reference page selector rendered only ${options} options`);
  }

  // Use the reference's own controls. The page change resets state to
  // populated; set page first, then theme, layout and state.
  await page.selectOption("#ks-page", viewId);
  await page.selectOption("#ks-theme", theme);
  await page.selectOption("#ks-size", viewport.layout);
  await page.selectOption("#ks-state", "populated");
  await page.waitForTimeout(250);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  // Hide only the outer review harness. Do not alter the prototype frame's
  // width, min-height, typography, controls or content.
  await page.addStyleTag({
    content: `
      #khelsuite-owner-review > :not(.ks-product) { display: none !important; }
      html, body { margin: 0 !important; padding: 0 !important; }
    `,
  });
  await page.waitForTimeout(200);

  const measurement = await page.evaluate(() => {
    const product = document.querySelector(".ks-product") as HTMLElement | null;
    const sidebar = document.querySelector(".ks-sidebar") as HTMLElement | null;
    const top = document.querySelector(".ks-top") as HTMLElement | null;
    const rect = (element: HTMLElement | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        x: Math.round(box.x * 10) / 10,
        y: Math.round(box.y * 10) / 10,
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
      };
    };
    const productStyle = product ? getComputedStyle(product) : null;
    return {
      product: rect(product),
      sidebar: rect(sidebar),
      top: rect(top),
      scrollWidth: product?.scrollWidth ?? 0,
      clientWidth: product?.clientWidth ?? 0,
      documentScrollHeight: document.documentElement.scrollHeight,
      transform: productStyle?.transform ?? "none",
      title: document.title,
      crumb: document.querySelector("#ks-crumb")?.textContent?.trim() ?? "",
      heading: document.querySelector("#ks-main h1")?.textContent?.trim() ?? "",
      note: document.querySelector("#ks-note")?.textContent?.trim() ?? "",
      selected: {
        page: (document.querySelector("#ks-page") as HTMLSelectElement | null)?.value ?? "",
        theme: (document.querySelector("#ks-theme") as HTMLSelectElement | null)?.value ?? "",
        size: (document.querySelector("#ks-size") as HTMLSelectElement | null)?.value ?? "",
        state: (document.querySelector("#ks-state") as HTMLSelectElement | null)?.value ?? "",
      },
    };
  });
  if (!measurement.product) {
    throw new Error("prototype frame .ks-product was not rendered");
  }
  if (
    measurement.selected.page !== viewId ||
    measurement.selected.theme !== theme ||
    measurement.selected.size !== viewport.layout ||
    measurement.selected.state !== "populated"
  ) {
    throw new Error(
      `reference controls did not stick: ${JSON.stringify(measurement.selected)}`,
    );
  }
  if (measurement.transform !== "none") {
    throw new Error(`prototype frame carries a transform: ${measurement.transform}`);
  }

  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({
    path: screenshot,
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
  const bytes = await readFile(screenshot);
  const size = pngSize(bytes);
  if (size.width !== viewport.width || size.height !== viewport.height) {
    throw new Error(
      `screenshot ${size.width}x${size.height} does not match viewport ${viewport.width}x${viewport.height}`,
    );
  }
  return {
    id: `${viewport.layout}-${theme}-${viewId}`,
    viewId,
    theme,
    viewport: viewport.name,
    layout: viewport.layout,
    state: "populated",
    controls: {
      page: "#ks-page",
      theme: "#ks-theme",
      layout: "#ks-size",
      state: "#ks-state",
    },
    screenshot: relative(ROOT, screenshot),
    screenshotSize: size,
    screenshotBytes: bytes.length,
    frame: {
      ...(measurement.product as {
        x: number;
        y: number;
        width: number;
        height: number;
      }),
      scrollWidth: measurement.scrollWidth,
      clientWidth: measurement.clientWidth,
      documentScrollHeight: measurement.documentScrollHeight,
      transform: measurement.transform,
      deviceScaleFactor: 1,
    },
    text: {
      title: measurement.title,
      crumb: measurement.crumb,
      heading: measurement.heading,
      note: measurement.note,
    },
  };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const allViews = args.includes("--all-views");
  let filter = (argValue(args, "--view") ?? DEFAULT_VIEWS.join(","))
    .split(",")
    .map((view) => view.trim())
    .filter(Boolean);
  if (allViews) {
    const matrix = JSON.parse(
      await readFile(
        join(ROOT, "docs/design/owner-openpen-20261029/qa/final-matrix.json"),
        "utf8",
      ),
    ) as { views: Array<{ viewId: string; referenceIds: string[] }> };
    filter = matrix.views.map((view) => view.referenceIds[0] ?? view.viewId);
  }
  const all = args.includes("--all");
  const requestedTheme = argValue(args, "--theme") as Theme | undefined;
  const requestedViewport = argValue(args, "--viewport") as
    | ViewportName
    | undefined;
  if (requestedTheme && !THEMES.includes(requestedTheme)) {
    throw new Error(`unknown theme ${requestedTheme}`);
  }
  if (requestedViewport && !VIEWPORTS[requestedViewport]) {
    throw new Error(`unknown viewport ${requestedViewport}`);
  }
  if (!relative(ROOT, OUT_DIR).startsWith(".playwright-mcp")) {
    throw new Error("Reference captures must stay under ignored .playwright-mcp/");
  }

  const runs = all
    ? THEMES.flatMap((theme) =>
        (Object.keys(VIEWPORTS) as ViewportName[]).map((viewportName) => ({
          theme,
          viewport: VIEWPORTS[viewportName],
        })),
      )
    : [
        {
          theme: requestedTheme ?? "lavender",
          viewport: VIEWPORTS[requestedViewport ?? "desktop-1280x900"],
        },
      ];

  const referenceBytes = await readFile(REFERENCE);
  const referenceSha256 = createHash("sha256").update(referenceBytes).digest("hex");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    acceptDownloads: false,
  });
  const page = await context.newPage();
  const records: FrameCapture[] = [];
  const failures: Array<Record<string, unknown>> = [];
  try {
    for (const run of runs) {
      for (const viewId of filter) {
        process.stdout.write(
          `reference ${run.viewport.layout}/${run.theme}/${viewId} … `,
        );
        try {
          const record = await renderOne(page, viewId, run.theme, run.viewport);
          records.push(record);
          console.log(`captured ${record.frame.width}x${record.frame.height}`);
        } catch (error) {
          failures.push({
            viewId,
            theme: run.theme,
            viewport: run.viewport.name,
            error: String(error).slice(0, 1000),
          });
          console.log("FAILED");
        }
      }
    }
    const manifest = {
      script: "capture-reference",
      status: failures.length ? "PARTIAL" : "CAPTURED",
      capturedAt: new Date().toISOString(),
      purpose:
        "Exact local reference input capture through the reference UI controls; visual comparison input only, not final app review.",
      reference: {
        path: relative(ROOT, REFERENCE),
        sha256: referenceSha256,
        bytes: referenceBytes.length,
      },
      browser: {
        channel: "chrome",
        headless: true,
        isolatedContext: true,
        deviceScaleFactor: 1,
        timezone: "Asia/Kolkata",
      },
      controls: {
        page: "#ks-page",
        theme: "#ks-theme",
        layout: "#ks-size",
        state: "#ks-state",
        note: "Page is selected first because the reference resets state to populated when the page changes.",
      },
      runs: runs.map((run) => ({
        theme: run.theme,
        layout: run.viewport.layout,
        viewport: {
          name: run.viewport.name,
          width: run.viewport.width,
          height: run.viewport.height,
        },
      })),
      requestedViews: filter,
      records,
      failures,
      notes: [
        "The outer review harness was hidden for the screenshot; the prototype frame was not resized, scaled or given invented content.",
        "For phone, the built-in Layout select was set to phone and the Chrome viewport was 390x844; frame dimensions are recorded separately.",
        "Screenshots are exact viewport captures; product frame height may differ from the viewport and is recorded in frame.height/documentScrollHeight.",
        "Illustrative reference data is not an app acceptance criterion.",
      ],
    };
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      join(OUT_DIR, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    console.log(
      `reference render: ${records.length}/${runs.length * filter.length} captured; ` +
        `${failures.length} failed; manifest=${relative(ROOT, join(OUT_DIR, "manifest.json"))}`,
    );
    return failures.length ? 1 : 0;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`REFERENCE STOP: ${String(error).slice(0, 1200)}`);
    process.exitCode = 1;
  });
