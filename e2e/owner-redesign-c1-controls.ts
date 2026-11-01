#!/usr/bin/env tsx
/**
 * Owner redesign · System lane — the rendered control-geometry probe.
 *
 * The approved control contract (docs/design/owner-redesign-20261027/
 * contract.md) is a statement about RENDERED geometry, not about class
 * strings:
 *
 *   "Standard action buttons, text fields, selects, date and time pickers
 *    share a 48px height, 10px radius, 16px control text and consistent
 *    horizontal padding. Long actions may wrap and grow; do not clip them
 *    to meet a numeric height. Compact table/tertiary controls retain at
 *    least 44px effective targets."
 *
 *   "A toolbar aligns control bottoms. Labels sit consistently above
 *    fields; no extra field margin changes the row alignment."
 *
 *   "Neutral entry/search fields; very lightly tinted pickers; a slightly
 *    stronger theme tint for secondary action buttons; solid theme colour
 *    for the primary action."
 *
 * This probe MEASURES that in Chrome: the computed height, radius, font
 * size and painted background of the real controls on the real pages, at
 * the contract's viewports, in both presets. A class-string assertion can
 * only prove that a class was written; only a computed style proves the
 * control is 48px and 10px on screen.
 *
 * It also proves the layout facts a class string cannot: the shell's
 * controls ALIGN on their bottoms, the owner sidebar and the sticky
 * header SURVIVE a long page (top, middle and bottom), and no viewport
 * gains a horizontal scrollbar.
 *
 * It never writes to the database and never clears browser data: it uses
 * its own isolated browser context and the demo credentials of a
 * DISPOSABLE database.
 *
 * Run it through .opencode/scripts/preview_job.py, which owns the
 * preview server as ONE compound job so the shared lease is held for the
 * whole browser workflow and released with it.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3181";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const ACCOUNTANT_PHONE = process.env.AQUA_E2E_ACCOUNTANT_PHONE ?? "+919000000006";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const OUT_DIR =
  process.env.AQUA_E2E_OUT ??
  "docs/handoffs/evidence/owner-redesign-system-c1";

/**
 * The contract's viewports (DESIGN.md §2.1 plus the phone).
 *
 * `zoom-200-reflow-proxy-640x450` is a REFLOW/DEVICE-SCALE PROXY for a
 * 200% browser zoom: a 640×450 CSS viewport at a device pixel ratio of 2
 * is the LAYOUT a 1280×900 window has at 200%. It is NOT an actual
 * Chrome browser zoom — no documented Playwright/CDP API applies the
 * browser's own zoom factor — and it is never reported as one. The
 * dedicated zoom proof below is a separate, explicit measurement.
 */
export const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "desktop-1280x900", width: 1280, height: 900 },
  { name: "short-desktop-1280x600", width: 1280, height: 600 },
  { name: "breakpoint-edge-1023x768", width: 1023, height: 768 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  { name: "zoom-200-reflow-proxy-640x450", width: 640, height: 450 },
];

/** The standard control: 48px, 10px radius, 16px control text. */
const STANDARD_HEIGHT = 48;
const STANDARD_RADIUS = 10;
const STANDARD_TEXT = 16;
/** The compact floor a table/tertiary control may keep. */
const COMPACT_FLOOR = 44;

type Probe = {
  route: string;
  selector: string;
  label: string;
  kind: "standard" | "compact";
  /** The surface the control must paint: neutral entry or tinted picker. */
  surface?: "entry" | "picker";
  /**
   * The radius the control must paint. A control that opts out of the
   * control radius says so here ("pill").
   */
  radius?: number | "pill";
  /**
   * A control another lane owns: measured and REPORTED, never blocking.
   * The System lane does not own those files, so their gap is a request
   * for the owning lane, not a failure of this lane's work.
   */
  boundary?: boolean;
};

const PROBES: Probe[] = [
  {
    route: "/owner",
    selector: '[data-testid="global-search-input"]',
    label: "the record search (neutral entry field)",
    kind: "standard",
    surface: "entry",
  },
  {
    route: "/owner",
    selector: '[data-testid="facility-switcher"]',
    label: "the facility switcher (picker)",
    kind: "standard",
    surface: "picker",
  },
  {
    route: "/owner",
    selector: '[data-testid="theme-toggle"]',
    label: "the appearance control",
    kind: "standard",
    surface: "entry",
  },
  {
    route: "/owner",
    selector: '[data-testid="owner-home-actions"] a',
    label: "the Home action (solid theme colour)",
    kind: "standard",
  },
  {
    route: "/owner",
    selector: '[data-testid="owner-payment-mix-legend"] a',
    label: "the payment-mix group drill-down",
    kind: "compact",
  },
  {
    route: "/owner",
    selector: '[data-testid="owner-payment-mix-method-link"]',
    label: "the payment-mix method drill-down",
    kind: "compact",
  },
  {
    // The SHARED DateField primitive, measured on a real page that is
    // not the System lane's: a shared-consumer check.
    route: "/owner/members/new",
    selector: '[data-testid="member-dob"]',
    label: "the shared date picker (picker)",
    kind: "standard",
    surface: "picker",
  },
  {
    // The SHARED Button primitive with NO explicit size: the shared
    // default has to render at the 48px standard, not at 44px.
    route: "/owner/settings/terminology",
    selector: '[data-control="button"]',
    label: "the shared button (default size)",
    kind: "standard",
    radius: "pill",
  },
  {
    route: "/owner/members/new",
    selector: '[data-testid="member-full-name"]',
    label: "the member text field (People lane, hand-rolled)",
    kind: "standard",
    surface: "entry",
    boundary: true,
  },
  {
    route: "/owner/members/new",
    selector: 'select[aria-label="Gender"]',
    label: "the member select (People lane, hand-rolled)",
    kind: "standard",
    surface: "picker",
    boundary: true,
  },
];

type Measurement = {
  viewport: string;
  preset: string;
  route: string;
  label: string;
  selector: string;
  boundary: boolean;
  found: boolean;
  height: number | null;
  width: number | null;
  radius: number | null;
  fontSize: number | null;
  background: string | null;
  bottom: number | null;
  failures: string[];
  notes: string[];
  /** Set when the control was ABSENT — a readiness problem, not a visual one. */
  missing: string | null;
};

type Finding = {
  viewport: string;
  preset: string;
  route: string;
  label: string;
  problem: string;
};

/**
 * The tint rule, read from the actual painted colour.
 *
 * The colour is normalised through a canvas in the page, because Chrome
 * may serialise a `color-mix()` result as sRGB, oklab or another space,
 * and a string comparison would then be a guess. The canvas resolves any
 * CSS colour to sRGB pixels, which is what the reader actually sees.
 *
 * A PICKER is tinted with the theme; an ordinary ENTRY field stays
 * neutral (a grey, r === g === b).
 */
function tintOf(rgb: [number, number, number] | null): string | null {
  if (!rgb) return null;
  const [r, g, b] = rgb;
  return Math.max(r, g, b) - Math.min(r, g, b) > 2 ? "tinted" : "neutral";
}

/** Read the computed geometry of the first match of a selector. */
async function measure(page: Page, probe: Probe, viewport: string, preset: string) {
  const read = async () =>
    page.evaluate((selector) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return null;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      // Normalise the painted colour through a canvas: Chrome may
      // serialise a color-mix() result as sRGB, oklab or another space.
      let rgb: [number, number, number] | null = null;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = style.backgroundColor;
          ctx.fillRect(0, 0, 1, 1);
          const data = ctx.getImageData(0, 0, 1, 1).data;
          rgb = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
        }
      } catch {
        rgb = null;
      }
      return {
        height: Math.round(box.height * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        radius: parseFloat(style.borderTopLeftRadius) || 0,
        fontSize: parseFloat(style.fontSize) || 0,
        background: style.backgroundColor,
        rgb,
        bottom: Math.round(box.bottom * 100) / 100,
      };
    }, probe.selector);

  let result = await read();
  // A control that is present but not laid out yet measures 0px. Give
  // it a BOUNDED moment to be laid out before calling it a defect.
  for (let attempt = 0; attempt < 4 && result && result.height === 0; attempt++) {
    await page.waitForTimeout(400);
    result = await read();
  }

  const failures: string[] = [];
  if (!result) {
    // The control is ABSENT. That is a READINESS problem — the surface
    // did not render the control this probe expects — and it is
    // reported separately from a geometry failure. It is never counted
    // as the intended visual RED.
    return {
      viewport,
      preset,
      route: probe.route,
      label: probe.label,
      selector: probe.selector,
      boundary: probe.boundary === true,
      found: false,
      height: null,
      width: null,
      radius: null,
      fontSize: null,
      background: null,
      bottom: null,
      failures: [],
      notes: [],
      missing: `the control was not found on ${probe.route}`,
    } satisfies Measurement;
  }

  const minimum = probe.kind === "standard" ? STANDARD_HEIGHT : COMPACT_FLOOR;
  if (result.height < minimum - 0.5) {
    failures.push(
      `height ${result.height}px is below the ${
        probe.kind === "standard" ? "48px standard" : "44px compact floor"
      }`,
    );
  }
  // The floor is an EFFECTIVE 44×44 target, not a height alone: a short
  // label ("Cash") can be 44px tall and still be a narrow target.
  if (probe.kind === "compact" && result.width < COMPACT_FLOOR - 0.5) {
    failures.push(
      `width ${result.width}px is below the 44px effective target width`,
    );
  }
  if (probe.kind === "standard") {
    const radius = probe.radius ?? STANDARD_RADIUS;
    if (radius === "pill") {
      if (result.radius < 44) {
        failures.push(`radius ${result.radius}px is not a pill radius`);
      }
    } else if (result.radius !== radius) {
      failures.push(`radius ${result.radius}px is not the approved ${radius}px`);
    }
  }
  if (probe.kind === "standard" && result.fontSize < STANDARD_TEXT) {
    failures.push(`control text ${result.fontSize}px is below 16px`);
  }
  if (probe.surface === "entry" && tintOf(result.rgb) !== "neutral") {
    failures.push(
      `an ordinary entry field must stay neutral, but it paints ${result.background}`,
    );
  }
  if (probe.surface === "picker" && tintOf(result.rgb) !== "tinted") {
    failures.push(
      `a picker must carry the subtle theme tint, but it paints ${result.background}`,
    );
  }

  return {
    viewport,
    preset,
    route: probe.route,
    label: probe.label,
    selector: probe.selector,
    boundary: probe.boundary === true,
    found: true,
    ...result,
    failures,
    notes: [],
    missing: null,
  } satisfies Measurement;
}

/** The document must never gain a horizontal scrollbar. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

/**
 * The shell's controls must align on their BOTTOMS: a toolbar that
 * aligns only its centres looks broken once one control grows.
 */
async function shellBottomAlignment(page: Page) {
  return page.evaluate(() => {
    const search = document.querySelector(
      '[data-testid="global-search-input"]',
    ) as HTMLElement | null;
    const toggle = document.querySelector(
      '[data-testid="theme-toggle"]',
    ) as HTMLElement | null;
    if (!search || !toggle) return null;
    return {
      searchBottom: Math.round(search.getBoundingClientRect().bottom * 100) / 100,
      toggleBottom: Math.round(toggle.getBoundingClientRect().bottom * 100) / 100,
      searchHeight: Math.round(search.getBoundingClientRect().height * 100) / 100,
      toggleHeight: Math.round(toggle.getBoundingClientRect().height * 100) / 100,
    };
  });
}

/**
 * The long-page proof.
 *
 * The UI quality review's recorded defect was "Members scrolling removes
 * sidebar contents from view". This scrolls a long page to the top, the
 * middle and the bottom and reads, at each stop:
 *
 *   - the page really is longer than the viewport (otherwise there is
 *     nothing to prove),
 *   - the sticky header still sits at the top of the viewport,
 *   - the sidebar is still fully inside the viewport,
 *   - the navigation region is its own scroll owner, and
 *   - the content column is NOT a second vertical scroller.
 */
async function longPageStops(page: Page) {
  const stops: {
    position: string;
    scrollY: number;
    documentHeight: number;
    viewportHeight: number;
    sideways: number;
    headerTop: number | null;
    sidebarVisible: boolean;
    sidebarTop: number | null;
    sidebarBottom: number | null;
    navScrollsOnItsOwn: boolean | null;
    contentIsAScroller: boolean | null;
  }[] = [];

  const read = async (position: string, ratio: number) => {
    await page.evaluate((r) => {
      const doc = document.documentElement;
      window.scrollTo(0, Math.round((doc.scrollHeight - doc.clientHeight) * r));
    }, ratio);
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => {
      const doc = document.documentElement;
      const header = document.querySelector(
        '[data-testid="owner-top-bar"]',
      ) as HTMLElement | null;
      const sidebar = document.querySelector(
        '[data-testid="owner-sidebar"]',
      ) as HTMLElement | null;
      const navScroll = document.querySelector(
        '[data-testid="owner-side-nav-scroll"]',
      ) as HTMLElement | null;
      const content = document.querySelector(
        '[data-testid="owner-content"]',
      ) as HTMLElement | null;
      const headerBox = header?.getBoundingClientRect();
      const sidebarBox = sidebar?.getBoundingClientRect();
      return {
        scrollY: Math.round(window.scrollY),
        documentHeight: doc.scrollHeight,
        viewportHeight: doc.clientHeight,
        sideways: Math.max(0, doc.scrollWidth - doc.clientWidth),
        headerTop: headerBox ? Math.round(headerBox.top) : null,
        sidebarVisible: sidebar
          ? getComputedStyle(sidebar).display !== "none"
          : false,
        sidebarTop: sidebarBox ? Math.round(sidebarBox.top) : null,
        sidebarBottom: sidebarBox ? Math.round(sidebarBox.bottom) : null,
        navScrollsOnItsOwn: navScroll
          ? getComputedStyle(navScroll).overflowY === "auto" ||
            getComputedStyle(navScroll).overflowY === "scroll"
          : null,
        contentIsAScroller: content
          ? getComputedStyle(content).overflowY === "auto" ||
            getComputedStyle(content).overflowY === "scroll"
          : null,
      };
    });
    stops.push({ position, ...state });
  };

  await read("top", 0);
  await read("middle", 0.5);
  await read("bottom", 1);
  return stops;
}

/**
 * EVERY link of the payment-mix legend, measured in BOTH dimensions.
 *
 * The accessibility floor is an effective 44×44 target. A group link
 * ("Cash") and a method link ("UPI") are short words: they can be 44px
 * tall and still be a narrow target, so the width has to be measured
 * for each of them, not just the first one.
 */
async function legendTargets(page: Page) {
  return page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll('[data-testid="owner-payment-mix-legend"] a'),
    ) as HTMLElement[];
    return links.map((link) => {
      const box = link.getBoundingClientRect();
      return {
        label: (link.textContent ?? "").trim(),
        height: Math.round(box.height * 100) / 100,
        width: Math.round(box.width * 100) / 100,
      };
    });
  });
}

/**
 * The 200% ZOOM LAYOUT PROXY, measured in real Chrome.
 *
 * WHAT THIS IS: a Chrome context with a **640×450 CSS viewport at a
 * device pixel ratio of 2** — the LAYOUT a 1280×900 window has when the
 * browser's own zoom is at 200%, and the same layout the
 * `zoom-200-reflow-proxy-640x450` viewport above measures.
 *
 * WHAT THIS IS NOT: an actual Chrome browser zoom. Chrome's browser zoom
 * (Ctrl + "+") is a browser preference; no documented Playwright or
 * Chrome DevTools Protocol API applies it to a page — `Emulation
 * .setPageScaleFactor` is a PINCH zoom, which scales the picture
 * WITHOUT reflowing the layout, and so proves nothing about a zoomed
 * layout. An actual browser-zoom measurement is therefore **UNVERIFIED**
 * by this probe, and the report says exactly that.
 *
 * What the proxy does prove: the shell survives a 640×450 layout
 * viewport — no sideways scroll, the sticky header and the sidebar stay
 * in the viewport, and the controls keep their CSS-pixel metrics (CSS
 * pixels do not change with a scale factor).
 */
async function zoomProof() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const problems: string[] = [];
  const measured: Record<string, unknown> = {};
  try {
    const context = await browser.newContext({
      viewport: { width: 640, height: 450 },
      deviceScaleFactor: 2,
      storageState: undefined,
    });
    try {
      await signIn(context);
      const page = await context.newPage();
      try {
        await page.setViewportSize({ width: 640, height: 450 });
        for (const route of ["/owner", "/owner/members"]) {
          await page.goto(`${BASE_URL}${route}`, {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
          });
          const ready = await waitForRoute(page, route, "zoom-200");
          if (!ready.ok) {
            problems.push(ready.diagnostic ?? `${route} did not become ready`);
            continue;
          }
          const state = await page.evaluate(() => {
            const doc = document.documentElement;
            const header = document.querySelector(
              '[data-testid="owner-top-bar"]',
            ) as HTMLElement | null;
            const search = document.querySelector(
              '[data-testid="global-search-input"]',
            ) as HTMLElement | null;
            const headerBox = header?.getBoundingClientRect();
            const searchBox = search?.getBoundingClientRect();
            return {
              cssViewport: `${doc.clientWidth}×${doc.clientHeight}`,
              devicePixelRatio: window.devicePixelRatio,
              sideways: Math.max(0, doc.scrollWidth - doc.clientWidth),
              headerTop: headerBox ? Math.round(headerBox.top) : null,
              searchHeight: searchBox
                ? Math.round(searchBox.height * 100) / 100
                : null,
              searchRadius: search
                ? parseFloat(getComputedStyle(search).borderTopLeftRadius)
                : null,
            };
          });
          measured[route] = state;
          if (state.sideways > 0) {
            problems.push(
              `${route} scrolls sideways by ${state.sideways}px in the 640×450 zoom-layout proxy`,
            );
          }
          if (state.headerTop !== null && state.headerTop < -1) {
            problems.push(
              `${route}: the header left the viewport in the zoom-layout proxy (top ${state.headerTop})`,
            );
          }
          if (state.searchHeight !== null && state.searchHeight < 44) {
            problems.push(
              `${route}: the record search is ${state.searchHeight}px tall in the zoom-layout proxy`,
            );
          }
          if (state.searchRadius !== null && state.searchRadius !== 10) {
            problems.push(
              `${route}: the record search radius is ${state.searchRadius}px in the zoom-layout proxy`,
            );
          }
          await page.screenshot({
            path: join(OUT_DIR, `owner-zoom-200-${route.replace(/\//g, "-")}.png`),
            fullPage: false,
          });
        }
      } finally {
        await page.close();
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return { problems, measured };
}

/**
 * The CSS the browser actually SERVED, so a stale build cache can never
 * be mistaken for a layout defect.
 *
 * The coordinator found the served stylesheet still carrying the OLD
 * `sm:w-[176px]` while the source used `sm:w-36` — so the donut column
 * had no width at all and the page rendered with stale CSS. This reads
 * the stylesheets the document really loaded.
 */
async function servedCss(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const links = Array.from(
      document.querySelectorAll('link[rel="stylesheet"]'),
    ) as HTMLLinkElement[];
    let text = "";
    for (const link of links) {
      try {
        const response = await fetch(link.href);
        text += await response.text();
      } catch {
        // A stylesheet that cannot be read is reported by the missing
        // class check below.
      }
    }
    return text;
  });
}

/**
 * The APPROVED payment-mix PLACEMENT: the donut and its legend sit side
 * by side on a desktop.
 *
 * The independent review found that the composition always wrapped:
 * the donut slot (176px) plus the gap (20px) plus the legend minimum
 * (180px) needs 376px, but the mix card had roughly 270px of inner
 * width at 1280px — so the approved pairing was never what a reader
 * actually saw. The geometry checks that existed covered the targets
 * and the overflow; this one covers the RELATIVE PLACEMENT.
 */
async function paymentMixPlacement(page: Page) {
  return page.evaluate(() => {
    const donut = document.querySelector(
      '[data-testid="owner-payment-mix-donut"]',
    ) as HTMLElement | null;
    const legend = document.querySelector(
      '[data-testid="owner-payment-mix-legend"]',
    ) as HTMLElement | null;
    if (!donut || !legend) return null;
    const donutBox = donut.getBoundingClientRect();
    const legendBox = legend.getBoundingClientRect();
    const cardElement = donut.closest("article");
    const figure = donut.closest("figure");
    // The GRID ancestor: the figure's parent is the mix CARD, so the
    // band has to be found by walking up to the element that carries
    // the grid columns.
    let band: HTMLElement | null = figure;
    while (
      band &&
      !((band.getAttribute("class") ?? "").includes("grid-cols-"))
    ) {
      band = band.parentElement;
    }
    const cardBox = cardElement?.getBoundingClientRect();
    const figureBox = figure?.getBoundingClientRect();
    const columnStyle = getComputedStyle(donut);
    // The donut must be PAINTED with a positive box: a canvas or an
    // SVG that exists but is zero-sized (or hidden) is not a donut.
    const painted = Array.from(
      donut.querySelectorAll("canvas, svg"),
    ) as HTMLElement[];
    // A positive box alone is not enough: a hidden or transparent node
    // has a box but is not a chart. The painted node must be visible.
    const paintedNode = painted.find((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return (
        box.width > 1 &&
        box.height > 1 &&
        box.bottom > box.top &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    });
    const paintedBox = paintedNode?.getBoundingClientRect();
    return {
      cardWidth: cardBox ? Math.round(cardBox.width) : null,
      cardInnerWidth: cardBox
        ? Math.round(
            cardBox.width -
              parseFloat(
                getComputedStyle(cardElement as HTMLElement).paddingLeft,
              ) -
              parseFloat(
                getComputedStyle(cardElement as HTMLElement).paddingRight,
              ),
          )
        : null,
      figureWidth: figureBox ? Math.round(figureBox.width) : null,
      donutColumnWidth: Math.round(donutBox.width),
      donutColumnClass: donut.getAttribute("class") ?? "",
      donutColumnDisplay: columnStyle.display,
      donutColumnCssWidth: columnStyle.width,
      smMediaMatches: window.matchMedia("(min-width: 640px)").matches,
      donutPainted: Boolean(paintedBox),
      paintedWidth: paintedBox ? Math.round(paintedBox.width) : 0,
      paintedHeight: paintedBox ? Math.round(paintedBox.height) : 0,
      paintedTag: paintedNode ? paintedNode.tagName.toLowerCase() : null,
      paintedVisible: paintedNode
        ? (() => {
            const style = getComputedStyle(paintedNode);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0"
            );
          })()
        : false,
      bandClass: band?.getAttribute("class") ?? "",
      // The layout-critical utility classes, from the RIGHT elements:
      // the donut column's width, the band's columns, the mix card's
      // column span and the legend's minimum width.
      criticalClasses: [
        ...(donut.getAttribute("class") ?? "")
          .split(/\s+/)
          .filter((name) => name.includes("w-")),
        ...(band?.getAttribute("class") ?? "")
          .split(/\s+/)
          .filter((name) => name.includes("grid-cols-")),
        ...(cardElement?.getAttribute("class") ?? "")
          .split(/\s+/)
          .filter((name) => name.includes("col-span-")),
        ...(legend.getAttribute("class") ?? "")
          .split(/\s+/)
          .filter((name) => name.includes("min-w-")),
      ],
      legendWidth: Math.round(legendBox.width),
      donutLeft: Math.round(donutBox.left),
      donutRight: Math.round(donutBox.right),
      donutBottom: Math.round(donutBox.bottom),
      legendLeft: Math.round(legendBox.left),
      legendTop: Math.round(legendBox.top),
      legendBottom: Math.round(legendBox.bottom),
      // Side by side means BESIDE: the legend starts to the right of the
      // donut AND their vertical ranges overlap. A legend that merely
      // starts further right but sits below is a stacked pair.
      sideBySide:
        legendBox.left >= donutBox.right - 1 &&
        legendBox.top < donutBox.bottom &&
        legendBox.bottom > donutBox.top,
    };
  });
}

/**
 * The role projection: a role WITHOUT the booking gates must not be
 * offered the booking desk, and the destination must not open.
 *
 * The AUTHORIZATION assertion is an explicit HTTP status from the same
 * isolated session (`context.request` shares the context's cookies), so
 * it can only be 403 or 404. A browser navigation that aborts is NOT
 * proof of a denial — a crash or a cancelled navigation looks the same —
 * so the navigation outcome is recorded separately and an unknown
 * outcome stays a SETUP failure, never a security success.
 */
async function deniedRoleProjection(context: BrowserContext) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator('form button[type="submit"]');
    let enabled = false;
    for (let attempt = 0; attempt < 6 && !enabled; attempt++) {
      await page.fill("#login-phone", ACCOUNTANT_PHONE);
      await page.fill("#login-pin", PIN);
      await page.locator("#login-pin").blur();
      enabled = await page.evaluate(() => {
        const button = document.querySelector(
          'form button[type="submit"]',
        ) as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
      });
      if (!enabled) await page.waitForTimeout(1000);
    }
    if (!enabled) return { signedIn: false, hrefs: [] as string[], status: 0 };
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 30_000,
      }),
      submit.click(),
    ]);
    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
    const hrefs = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-testid="owner-side-nav"] a'),
      ).map((a) => a.getAttribute("href") ?? ""),
    );

    // The explicit authorization read, from the same session. The
    // STATUS is informational: the route STREAMS (it has a loading
    // boundary), so Next.js can answer 200 and render the not-found in
    // the stream. The AUTHORIZATION assertion is the rendered state.
    const response = await context.request
      .get(`${BASE_URL}/owner/bookings`, { maxRedirects: 0 })
      .catch(() => null);
    const status = response?.status() ?? 0;
    const body = response ? await response.text().catch(() => "") : "";

    // The browser's own view of the same route: the booking desk's own
    // control must NOT be there for a role without the gates.
    let navigation: string;
    let deskRendered = false;
    let notFoundRendered = false;
    try {
      await page.goto(`${BASE_URL}/owner/bookings`, {
        waitUntil: "domcontentloaded",
      });
      // The route STREAMS, so the not-found can arrive after the shell.
      await page
        .waitForSelector('[data-testid="not-found-page"]', {
          state: "attached",
          timeout: 15_000,
        })
        .catch(() => null);
      const state = await page.evaluate(() => ({
        desk: Boolean(
          document.querySelector('[data-testid="booking-create"]'),
        ),
        notFound: Boolean(
          document.querySelector('[data-testid="not-found-page"]'),
        ),
        text: (document.body?.textContent ?? "").replace(/\s+/g, " ").slice(0, 200),
      }));
      deskRendered = state.desk;
      notFoundRendered = state.notFound;
      navigation = state.text.slice(0, 120);
    } catch (error) {
      navigation = `the navigation did not complete (${
        error instanceof Error ? error.message.split("\n")[0] : "unknown"
      })`;
    }

    return {
      signedIn: true,
      hrefs,
      status,
      bodyHasNotFound: body.includes("not-found-page"),
      deskRendered,
      notFoundRendered,
      navigation,
    };
  } finally {
    await page.close();
  }
}

/**
 * Sign in and wait for the app to be LIVE, not merely served.
 *
 * The form is a React client component: filling it before the hydration
 * lands writes the DOM value without the state, and the submit button
 * stays closed. So the helper waits for the hydrated, enabled state and
 * never forces the button on.
 */
async function signIn(context: BrowserContext) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator('form button[type="submit"]');
    let enabled = false;
    for (let attempt = 0; attempt < 6 && !enabled; attempt++) {
      await page.fill("#login-phone", PHONE);
      await page.fill("#login-pin", PIN);
      // Blur the PIN field so the form's own validation runs.
      await page.locator("#login-pin").blur();
      enabled = await page.evaluate(() => {
        const button = document.querySelector(
          'form button[type="submit"]',
        ) as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
      });
      if (!enabled) await page.waitForTimeout(1000);
    }
    if (!enabled) {
      const alert = await page.evaluate(() => document.body.textContent ?? "");
      throw new Error(
        `the sign-in button never became enabled; the page said: ${alert
          .replace(/\s+/g, " ")
          .slice(0, 400)}`,
      );
    }

    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 30_000,
      }),
      submit.click(),
    ]);
  } finally {
    await page.close();
  }
}

/**
 * The marker that says the route's CONTENT has arrived.
 *
 * The shell is not enough: it renders before the page's data does, and
 * a long page measured before its list arrives is an empty page. Each
 * route therefore names the element that only exists once its content
 * is there.
 */
const ROUTE_MARKERS: Record<string, string> = {
  "/owner": '[data-testid="owner-home"]',
  "/owner/members": '[data-testid="members-list"]',
  "/owner/members/new": '[data-testid="member-full-name"]',
  "/owner/settings/terminology": '[data-testid^="terminology-form-"]',
};

/**
 * Wait until the route's content is rendered and hydrated.
 *
 * A BOUNDED readiness wait on a marker element, not a global
 * networkidle: the PWA polls in the background, so networkidle is never
 * a reliable "the page is ready" signal and it burns the whole budget.
 */
async function waitForRoute(
  page: Page,
  route: string,
  viewport: string,
): Promise<{ ok: boolean; diagnostic: string | null }> {
  const marker = ROUTE_MARKERS[route] ?? "main";
  try {
    await page.waitForSelector(marker, { state: "attached", timeout: 60_000 });
    await page.waitForFunction(
      () => document.readyState !== "loading",
      undefined,
      { timeout: 15_000 },
    );
    return { ok: true, diagnostic: null };
  } catch (error) {
    const diagnostic = await page
      .evaluate(() => {
        const text = (document.body?.textContent ?? "").replace(/\s+/g, " ");
        return text.slice(0, 300);
      })
      .catch(() => null);
    return {
      ok: false,
      diagnostic: `${route} @ ${viewport} did not become ready (${
        error instanceof Error ? error.message.split("\n")[0] : "unknown"
      }); the page said: ${diagnostic ?? "(nothing)"}`,
    };
  }
}

/**
 * Render a preset the way a reader would: the SERVER resolves the
 * preset from the `aqua_theme` cookie, so the first paint already
 * carries it. Overriding the attribute on the client after the server
 * rendered the other preset makes React report a hydration mismatch,
 * which is a probe artefact and not an application defect.
 */
async function setPreset(context: BrowserContext, preset: "mint" | "lavender") {
  await context.addCookies([
    { name: "aqua_theme", value: preset, url: BASE_URL },
  ]);
}

/** The preset the server actually rendered. */
async function renderedPreset(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.documentElement.dataset.theme ?? null,
  );
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  // The human's Chrome preference: the real browser, headless.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const measurements: Measurement[] = [];
  const findings: Finding[] = [];
  const notes: Finding[] = [];
  const readiness: Finding[] = [];
  const longPage: Record<string, unknown> = {};
  const legendMeasurement: {
    viewport: string;
    preset: string;
    label: string;
    height: number;
    width: number;
  }[] = [];
  let zoomMeasured: Record<string, unknown> = {};
  const placementMeasurement: {
    viewport: string;
    preset: string;
    cardWidth: number | null;
    cardInnerWidth: number | null;
    figureWidth: number | null;
    donutColumnWidth: number;
    donutColumnClass: string;
    donutColumnDisplay: string;
    donutColumnCssWidth: string;
    smMediaMatches: boolean;
    donutPainted: boolean;
    paintedWidth: number;
    paintedHeight: number;
    paintedTag: string | null;
    bandClass: string;
    criticalClasses: string[];
    legendWidth: number;
    donutLeft: number;
    donutRight: number;
    donutBottom: number;
    legendLeft: number;
    legendTop: number;
    legendBottom: number;
    sideBySide: boolean;
  }[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      // An isolated context: no shared profile, no stored browser state.
      storageState: undefined,
    });
    try {
      await signIn(context);

      // A short, bounded run of ONE check — used to validate the role
      // projection on its own, without paying for the whole matrix.
      const only = process.env.AQUA_E2E_ONLY ?? "";
      const presets: ("mint" | "lavender")[] =
        only === "legend" || only === "pairs"
          ? ["mint"]
          : ["mint", "lavender"];
      const viewports =
        only === "legend"
          ? VIEWPORTS.filter(
              (viewport) =>
                viewport.name === "phone-390x844" ||
                viewport.name === "desktop-1280x900",
            )
          : VIEWPORTS;
      const routes =
        only === "legend" || only === "pairs"
          ? ["/owner"]
          : Array.from(new Set(PROBES.map((probe) => probe.route)));

      for (const preset of presets) {
        // The preset is a device preference the SERVER resolves, so the
        // cookie is set before the pass and nothing is overridden on the
        // client afterwards.
        await setPreset(context, preset);
        for (const viewport of viewports) {
          const page = await context.newPage();
          // The console is part of the evidence: a hydration error or a
          // client exception on a surface is a finding, not a noise.
          const consoleErrors: string[] = [];
          page.on("console", (message) => {
            if (message.type() === "error") {
              consoleErrors.push(message.text().slice(0, 200));
            }
          });
          page.on("pageerror", (error) => {
            consoleErrors.push(`pageerror: ${error.message.slice(0, 200)}`);
          });
          try {
            await page.setViewportSize({
              width: viewport.width,
              height: viewport.height,
            });
            for (const route of routes) {
              const response = await page.goto(`${BASE_URL}${route}`, {
                waitUntil: "domcontentloaded",
                timeout: 60_000,
              });
              if (!response || response.status() >= 400) {
                readiness.push({
                  viewport: viewport.name,
                  preset,
                  route,
                  label: "the route",
                  problem: `the route answered ${response?.status() ?? "no response"}`,
                });
                continue;
              }
              const ready = await waitForRoute(page, route, viewport.name);
              if (!ready.ok) {
                readiness.push({
                  viewport: viewport.name,
                  preset,
                  route,
                  label: "the route",
                  problem: ready.diagnostic ?? "the route did not become ready",
                });
                continue;
              }
              await setPreset(context, preset);
              const shown = await renderedPreset(page);
              if (shown !== preset) {
                readiness.push({
                  viewport: viewport.name,
                  preset,
                  route,
                  label: "the preset",
                  problem: `the server rendered the "${shown ?? "default"}" preset, not "${preset}"`,
                });
              }
              // The chart island is a lazy chunk: wait for it, so a
              // screenshot of the money band shows the chart and not its
              // loading placeholder. Only the Home has a chart.
              if (route === "/owner") {
                await page
                  .waitForSelector('[data-testid="owner-chart"]', {
                    state: "attached",
                    timeout: 20_000,
                  })
                  .catch(() => null);
              }

              for (const probe of PROBES.filter((p) => p.route === route)) {
                const measurement = await measure(
                  page,
                  probe,
                  viewport.name,
                  preset,
                );
                measurements.push(measurement);
                if (measurement.missing) {
                  readiness.push({
                    viewport: viewport.name,
                    preset,
                    route: probe.route,
                    label: probe.label,
                    problem: measurement.missing,
                  });
                }
                for (const problem of measurement.failures) {
                  if (probe.boundary) {
                    notes.push({
                      viewport: viewport.name,
                      preset,
                      route: probe.route,
                      label: probe.label,
                      problem,
                    });
                    continue;
                  }
                  findings.push({
                    viewport: viewport.name,
                    preset,
                    route: probe.route,
                    label: probe.label,
                    problem,
                  });
                }
              }

              // The layout facts a class string cannot prove, on the
              // owner Home.
              if (route === "/owner") {
                const overflow = await horizontalOverflow(page);
                if (overflow > 0) {
                  findings.push({
                    viewport: viewport.name,
                    preset,
                    route,
                    label: "the owner Home",
                    problem: `the page scrolls sideways by ${overflow}px`,
                  });
                }
                const alignment = await shellBottomAlignment(page);
                if (
                  alignment &&
                  Math.abs(alignment.searchBottom - alignment.toggleBottom) > 1
                ) {
                  findings.push({
                    viewport: viewport.name,
                    preset,
                    route,
                    label: "the shell toolbar",
                    problem: `the record search and the appearance control do not share a bottom edge (${alignment.searchBottom} vs ${alignment.toggleBottom})`,
                  });
                }

                // EVERY payment-mix link, in BOTH dimensions: the floor
                // is an effective 44×44 target, not a height alone.
                for (const link of await legendTargets(page)) {
                  legendMeasurement.push({
                    viewport: viewport.name,
                    preset,
                    ...link,
                  });
                  if (
                    link.height < COMPACT_FLOOR - 0.5 ||
                    link.width < COMPACT_FLOOR - 0.5
                  ) {
                    findings.push({
                      viewport: viewport.name,
                      preset,
                      route,
                      label: `the payment-mix link "${link.label}"`,
                      problem: `the target is ${link.width}×${link.height}px, below the 44×44 floor`,
                    });
                  }
                }

                // The APPROVED placement of the donut and its legend.
                // The composition must NEVER wrap while there is room
                // for the pair: the pair needs 144px (the donut) + 20px
                // (the gap) + 160px (the legend minimum) = 324px, so a
                // card with 324px or more of inner width has to show the
                // side-by-side arrangement. Below that the pair stacks
                // deliberately, which is the phone/narrow-desktop case.
                if (
                  viewport.width >= 1024 &&
                  (await page
                    .locator('[data-testid="owner-payment-mix-donut"]')
                    .count()) > 0
                ) {
                  // The desktop donut is the lazy ECharts island: until
                  // the chunk lands the column is EMPTY (zero width), and
                  // a zero-width column would make the pair look
                  // side-by-side when it is not. Wait for the chart.
                  await page
                    .waitForSelector('[data-testid="owner-chart"]', {
                      state: "attached",
                      timeout: 20_000,
                    })
                    .catch(() => null);
                  const placement = await paymentMixPlacement(page);
                  if (placement) {
                    placementMeasurement.push({
                      viewport: viewport.name,
                      preset,
                      ...placement,
                    });
                    // The SERVED stylesheet must carry the layout
                    // classes the source uses. A stale build cache
                    // served the OLD classes, the donut column collapsed
                    // to zero width and the pair looked "side by side"
                    // beside an empty column.
                    const css = await servedCss(page);
                    const missing = placement.criticalClasses.filter(
                      (name) => !css.includes(name.split(":").pop() ?? name),
                    );
                    if (missing.length > 0) {
                      readiness.push({
                        viewport: viewport.name,
                        preset,
                        route,
                        label: "the payment mix",
                        problem: `the SERVED stylesheet is stale: ${missing.join(", ")} is not in it (a clean build of this checkout is needed)`,
                      });
                      continue;
                    }
                    if (placement.donutColumnWidth === 0 || !placement.donutPainted) {
                      readiness.push({
                        viewport: viewport.name,
                        preset,
                        route,
                        label: "the payment mix",
                        problem: `the donut is not painted (column ${placement.donutColumnWidth}px, painted ${placement.donutPainted}) — the placement cannot be judged`,
                      });
                      continue;
                    }
                    // On a desktop the donut is the ECharts CANVAS in
                    // the desktop chart slot. The phone's server-rendered
                    // SVG ring is a different slot and must not stand in
                    // for it.
                    if (
                      viewport.width >= 1024 &&
                      placement.paintedTag !== "canvas"
                    ) {
                      readiness.push({
                        viewport: viewport.name,
                        preset,
                        route,
                        label: "the payment mix",
                        problem: `the desktop chart slot painted a "${placement.paintedTag}", not the ECharts canvas`,
                      });
                      continue;
                    }
                    // The approved donut slot.
                    if (placement.donutColumnWidth !== 144) {
                      findings.push({
                        viewport: viewport.name,
                        preset,
                        route,
                        label: "the payment mix",
                        problem: `the donut slot is ${placement.donutColumnWidth}px, not the approved 144px`,
                      });
                    }
                    // The pairing. At the approved desktop width it is
                    // REQUIRED, unconditionally — a narrow or stale
                    // card must not be able to excuse a stacked pair.
                    // Below it, the pair stacks when the card is too
                    // narrow for it, which is the deliberate narrow-
                    // desktop and phone case.
                    const pairMinimum = 324;
                    const required =
                      viewport.width >= 1280 ||
                      (placement.cardInnerWidth !== null &&
                        placement.cardInnerWidth >= pairMinimum);
                    if (required && !placement.sideBySide) {
                      findings.push({
                        viewport: viewport.name,
                        preset,
                        route,
                        label: "the payment mix",
                        problem: `the donut and its legend are stacked although the card has ${placement.cardInnerWidth}px of inner width and the pair needs ${pairMinimum}px`,
                      });
                    }
                  }
                }
                if (
                  viewport.name === "phone-390x844" ||
                  viewport.name === "desktop-1280x900"
                ) {
                  await page.screenshot({
                    path: join(
                      OUT_DIR,
                      `owner-home-${preset}-${viewport.name}.png`,
                    ),
                    fullPage: false,
                  });
                  // The money band, with the approved payment mix.
                  await page
                    .locator('[data-testid="owner-home-money"]')
                    .scrollIntoViewIfNeeded()
                    .catch(() => null);
                  await page.waitForTimeout(400);
                  await page.screenshot({
                    path: join(
                      OUT_DIR,
                      `owner-home-money-${preset}-${viewport.name}.png`,
                    ),
                    fullPage: false,
                  });
                }
              }
            }

            // The long-page proof, on the Members board.
            const members = await page.goto(`${BASE_URL}/owner/members`, {
              waitUntil: "domcontentloaded",
              timeout: 60_000,
            });
            if (members && members.status() < 400) {
              const ready = await waitForRoute(
                page,
                "/owner/members",
                viewport.name,
              );
              if (ready.ok) {
                // The long-page proof needs a page that is genuinely
                // longer than the viewport. The members list arrives
                // after its container, so the precondition is POLLED
                // rather than assumed: wait until the document is
                // actually scrollable.
                const longEnough = await page
                  .waitForFunction(
                    () =>
                      document.documentElement.scrollHeight >
                      document.documentElement.clientHeight + 50,
                    undefined,
                    { timeout: 20_000 },
                  )
                  .then(() => true)
                  .catch(() => false);
                if (!longEnough) {
                  readiness.push({
                    viewport: viewport.name,
                    preset,
                    route: "/owner/members",
                    label: "the long Members page",
                    problem:
                      "the members list never arrived, so the page is not longer than the viewport — there is nothing to prove",
                  });
                }
                const stops = await longPageStops(page);
                longPage[`${preset} ${viewport.name}`] = stops;
                const first = stops[0]!;
                if (first.documentHeight <= first.viewportHeight + 8) {
                  readiness.push({
                    viewport: viewport.name,
                    preset,
                    route: "/owner/members",
                    label: "the long Members page",
                    problem: `the page is not longer than the viewport (${first.documentHeight}px in ${first.viewportHeight}px) — there is nothing to prove`,
                  });
                }
                for (const stop of stops) {
                  if (stop.sideways > 0) {
                    findings.push({
                      viewport: viewport.name,
                      preset,
                      route: "/owner/members",
                      label: `the long Members page (${stop.position})`,
                      problem: `the page scrolls sideways by ${stop.sideways}px`,
                    });
                  }
                  if (!stop.sidebarVisible) continue;
                  if (
                    stop.sidebarTop === null ||
                    stop.sidebarBottom === null ||
                    stop.sidebarTop < -1 ||
                    stop.sidebarBottom > stop.viewportHeight + 1
                  ) {
                    findings.push({
                      viewport: viewport.name,
                      preset,
                      route: "/owner/members",
                      label: `the owner sidebar (${stop.position})`,
                      problem: `the sidebar left the viewport (top ${stop.sidebarTop}, bottom ${stop.sidebarBottom}, viewport ${stop.viewportHeight})`,
                    });
                  }
                  if (stop.navScrollsOnItsOwn === false) {
                    findings.push({
                      viewport: viewport.name,
                      preset,
                      route: "/owner/members",
                      label: `the owner navigation (${stop.position})`,
                      problem: "the navigation region is not its own scroll owner",
                    });
                  }
                  if (stop.contentIsAScroller) {
                    findings.push({
                      viewport: viewport.name,
                      preset,
                      route: "/owner/members",
                      label: `the owner content column (${stop.position})`,
                      problem: "the content column became a second vertical scroller",
                    });
                  }
                  if (
                    stop.headerTop !== null &&
                    stop.headerTop < -1 &&
                    stop.position !== "top"
                  ) {
                    findings.push({
                      viewport: viewport.name,
                      preset,
                      route: "/owner/members",
                      label: `the sticky header (${stop.position})`,
                      problem: `the header left the viewport (top ${stop.headerTop})`,
                    });
                  }
                }
                if (
                  viewport.name === "phone-390x844" ||
                  viewport.name === "desktop-1280x900"
                ) {
                  for (const stop of stops) {
                    await page.evaluate((r) => {
                      const doc = document.documentElement;
                      window.scrollTo(
                        0,
                        Math.round((doc.scrollHeight - doc.clientHeight) * r),
                      );
                    }, stop.position === "top" ? 0 : stop.position === "middle" ? 0.5 : 1);
                    await page.waitForTimeout(200);
                    await page.screenshot({
                      path: join(
                        OUT_DIR,
                        `owner-members-${preset}-${viewport.name}-${stop.position}.png`,
                      ),
                      fullPage: false,
                    });
                  }
                }
              } else {
                readiness.push({
                  viewport: viewport.name,
                  preset,
                  route: "/owner/members",
                  label: "the long Members page",
                  problem: ready.diagnostic ?? "the route did not become ready",
                });
              }
            }
          } finally {
            for (const message of consoleErrors) {
              findings.push({
                viewport: viewport.name,
                preset,
                route: "(console)",
                label: "the browser console",
                problem: message,
              });
            }
            await page.close();
          }
        }
      }

      // The 200% zoom LAYOUT PROXY proof, on its own.
      if (only === "zoom") {
        const zoom = await zoomProof();
        for (const problem of zoom.problems) {
          findings.push({
            viewport: "zoom-200",
            preset: "n/a",
            route: "/owner",
            label: "the zoomed layout",
            problem,
          });
        }
        zoomMeasured = zoom.measured;
      }

      // The role projection: a role WITHOUT the booking gates must not
      // be offered the booking desk, and the destination must not open.
      const projection = await deniedRoleProjection(context);
      if (projection.signedIn) {
        if (projection.hrefs.includes("/owner/bookings")) {
          findings.push({
            viewport: "role-projection",
            preset: "n/a",
            route: "/owner",
            label: "the Accountant's sidebar",
            problem: "the booking desk is offered to a role without the booking gates",
          });
        }
        // The explicit authorization assertion: for a role without the
        // booking gates the booking desk must NOT render, and the
        // not-found state must. The HTTP status is recorded but is NOT
        // the assertion: the route streams, so Next.js can answer 200
        // and render the not-found inside the stream.
        if (projection.deskRendered) {
          findings.push({
            viewport: "role-projection",
            preset: "n/a",
            route: "/owner/bookings",
            label: "the booking desk for a role without the gates",
            problem: "the booking desk rendered for a role without bookings.read",
          });
        }
        if (!projection.notFoundRendered && !projection.bodyHasNotFound) {
          readiness.push({
            viewport: "role-projection",
            preset: "n/a",
            route: "/owner/bookings",
            label: "the booking desk for a role without the gates",
            problem: `the denial was not observed (status ${projection.status}; the page said: ${projection.navigation})`,
          });
        }
      } else {
        readiness.push({
          viewport: "role-projection",
          preset: "n/a",
          route: "/login",
          label: "the Accountant's sign-in",
          problem: "the role projection could not sign in",
        });
      }
    } finally {
      await context.close();
    }
  } finally {
    // The browser MUST close even when the probe throws, or the job
    // keeps the shared lease.
    await browser.close();
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    baseUrl: BASE_URL,
    standard: {
      height: STANDARD_HEIGHT,
      radius: STANDARD_RADIUS,
      text: STANDARD_TEXT,
    },
    compactFloor: COMPACT_FLOOR,
    measurements,
    findings,
    notes,
    readiness,
    longPage,
    legendTargets: legendMeasurement,
    zoom: zoomMeasured,
  };
  writeFileSync(
    join(OUT_DIR, "owner-redesign-c1-controls.geometry.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const lines: string[] = [];
  lines.push("Owner redesign · System lane — rendered control geometry");
  lines.push(`base url: ${BASE_URL}`);
  lines.push("");
  for (const m of measurements) {
    lines.push(
      `${m.viewport.padEnd(30)} ${m.preset.padEnd(9)} ${m.route.padEnd(22)} ${m.label}`,
    );
    lines.push(
      `    height=${m.height} radius=${m.radius} text=${m.fontSize} bottom=${m.bottom} bg=${m.background}`,
    );
    for (const f of m.failures) lines.push(`    FAIL: ${f}`);
  }
  lines.push("");
  lines.push("The payment-mix legend targets (every link, both dimensions):");
  for (const link of legendMeasurement) {
    lines.push(
      `  ${link.viewport.padEnd(24)} ${link.preset.padEnd(9)} "${link.label}" ${link.width}×${link.height}px`,
    );
  }
  lines.push("");
  lines.push("The payment-mix placement (the approved side-by-side pairing):");
  for (const placement of placementMeasurement) {
    lines.push(
      `  ${placement.viewport.padEnd(30)} ${placement.preset.padEnd(9)} card ${placement.cardWidth}px (inner ${placement.cardInnerWidth}px)  figure ${placement.figureWidth}px  donut column ${placement.donutColumnWidth}px  painted ${placement.paintedTag} ${placement.paintedWidth}×${placement.paintedHeight}px  legend ${placement.legendWidth}px  side by side: ${placement.sideBySide}`,
    );
    lines.push(`      donut: ${placement.donutColumnClass}`);
    lines.push(`      band:  ${placement.bandClass}`);
    lines.push(`      css:   ${placement.criticalClasses.join(", ")}`);
  }
  lines.push("");
  lines.push(
    "The 200% zoom LAYOUT PROXY — a 640×450 CSS viewport at device pixel ratio 2 " +
      "(the layout a 1280×900 window has at 200%). An ACTUAL Chrome browser zoom is " +
      "UNVERIFIED: no documented browser API applies the browser's own zoom factor.",
  );
  for (const [route, state] of Object.entries(zoomMeasured)) {
    lines.push(`  ${route}`);
    lines.push(`    ${JSON.stringify(state)}`);
  }
  lines.push("");
  lines.push("The long-page proof (top / middle / bottom):");
  for (const [key, stops] of Object.entries(longPage)) {
    lines.push(`  ${key}`);
    for (const stop of stops as {
      position: string;
      scrollY: number;
      documentHeight: number;
      viewportHeight: number;
      headerTop: number | null;
      sidebarTop: number | null;
      sidebarBottom: number | null;
    }[]) {
      lines.push(
        `    ${stop.position.padEnd(7)} scrollY=${stop.scrollY} page=${stop.documentHeight}px viewport=${stop.viewportHeight}px headerTop=${stop.headerTop} sidebar=${stop.sidebarTop}..${stop.sidebarBottom}`,
      );
    }
  }
  lines.push("");
  if (readiness.length > 0) {
    lines.push(
      "READINESS (the surface did not render the control — a fixture or route problem, NOT a visual failure):",
    );
    for (const r of readiness) {
      lines.push(
        `  ${r.viewport} ${r.preset} ${r.route} — ${r.label}: ${r.problem}`,
      );
    }
    lines.push("");
  }
  if (notes.length > 0) {
    lines.push(
      "Reported (a control another lane owns — a request for that lane, not a failure here):",
    );
    for (const n of notes) {
      lines.push(
        `  ${n.viewport} ${n.preset} ${n.route} — ${n.label}: ${n.problem}`,
      );
    }
    lines.push("");
  }
  if (findings.length === 0 && readiness.length === 0) {
    lines.push("PASS — every probe met the approved control contract.");
  } else if (findings.length === 0) {
    lines.push(
      "BLOCKED (setup) — no layout finding, but a probe precondition was not met, so this run is NOT a pass.",
    );
  } else {
    lines.push(`${findings.length} finding(s):`);
    for (const f of findings) {
      lines.push(
        `  ${f.viewport} ${f.preset} ${f.route} — ${f.label}: ${f.problem}`,
      );
    }
  }
  const text = `${lines.join("\n")}\n`;
  writeFileSync(
    join(OUT_DIR, "owner-redesign-c1-controls.geometry.txt"),
    text,
  );
  process.stdout.write(text);
  if (findings.length > 0 || readiness.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
