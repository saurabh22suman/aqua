#!/usr/bin/env tsx
/**
 * The Home payment-mix ring: the exact total must stay inside the
 * ring's inner hole, or move next to the ring — never across the band.
 *
 * The reviewer's capture (final-states/states/{theme}/mobile-390x844/
 * home-monthly-collections.png) shows the centre label "₹2,66,355"
 * painting over the coloured ring in BOTH themes at 390.
 *
 * This probe measures the RENDERED geometry, in real Chrome:
 *
 *   * the ring's own geometry is read from the DOM (the circle's `r`
 *     and `stroke-width`, the group's translate), never from a
 *     hard-coded constant;
 *   * the label's ink box is measured with a DOM Range over its text
 *     node, not from the SVG's outer rectangle;
 *   * the label must sit inside the inner CIRCLE — every corner of the
 *     ink box inside the hole, because the hole narrows towards the
 *     label's own vertical corners;
 *   * the amount must be the exact total: a full rupee figure, never
 *     truncated, rounded or shrunk, and it must equal the sum of the
 *     legend's own category amounts;
 *   * when the amount is drawn next to the ring, it must be fully
 *     readable there, and the "collected" caption must stay with it —
 *     inside the ring or beside the amount.
 *
 * It changes nothing: no DOM patching, no CSS patching, no fixture
 * mutation. It reads the page and writes the evidence.
 *
 * The phone cases are REQUIRED: the probe reads the populated period
 * (`?period=month`), and a phone run with no ring, no total or no
 * legend is a FAILURE, never a quiet pass. The exit code is 0 only
 * when both themes' phone cases were measured and passed.
 *
 * Run it against a bounded preview:
 *
 *   python3 .opencode/scripts/lane_job.py exec python3 \
 *     .opencode/scripts/owner_preview.py --port <port> --out <out> \
 *     --production -- pnpm exec tsx \
 *     tests/owner-openpen-20261029/system/home-donut-hole-containment.ts
 *
 * Exit code 0 means every required case was measured and passed.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3273";
const OUT = process.env.AQUA_E2E_OUT ?? ".playwright-mcp/home-donut-hole";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";

const THEMES = ["mint", "lavender"] as const;
const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844, required: true },
  { name: "tablet-1024x768", width: 1024, height: 768, required: false },
  { name: "desktop-1280x900", width: 1280, height: 900, required: false },
];

/** The smallest body text the owner may have to read, in CSS pixels. */
const MIN_READABLE_PX = 12;
/** A full rupee figure: grouped digits, optional paise, nothing cut. */
const FULL_INR = /^₹\s?[\d,]+(?:\.\d{2})?$/;
/** The slack the ink box may have against the hole, in user units. */
const CONTAINMENT_SLACK = 1;

type RingGeometry = {
  present: boolean;
  visible: boolean;
  viewBox: string;
  scale: number;
  holeRadius: number | null;
  holeCentre: { x: number; y: number } | null;
  label: string | null;
  labelInRing: boolean;
  labelBox: { left: number; top: number; right: number; bottom: number } | null;
  /** The label's painted size in CSS pixels (the SVG's font size scaled). */
  labelFontPx: number | null;
  outsideAmount: string | null;
  outsideFontPx: number | null;
  /** The "collected" caption, wherever it ended up. */
  captionInRing: boolean;
  captionBesideAmount: boolean;
  legendAmounts: string[];
  overflow: number;
};

type Case = {
  theme: string;
  viewport: string;
  required: boolean;
  /** The preset the page actually rendered, read from the document. */
  appliedTheme: string | null;
  geometry: RingGeometry;
  state: "measured" | "not-applicable";
  failures: string[];
};

mkdirSync(OUT, { recursive: true });

async function signIn(context: BrowserContext) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator("form button[type=submit]");
    let enabled = false;
    for (let attempt = 0; attempt < 8 && !enabled; attempt += 1) {
      await page.fill("#login-phone", PHONE);
      await page.fill("#login-pin", PIN);
      await page.locator("#login-pin").blur();
      enabled = await page.evaluate(() => {
        const button = document.querySelector(
          'form button[type="submit"]',
        ) as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
      });
      if (!enabled) await page.waitForTimeout(750);
    }
    if (!enabled) throw new Error("sign-in never became enabled");
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 45_000,
      }),
      submit.click(),
    ]);
  } finally {
    await page.close();
  }
}

/** The money strings a legend states, in the order it states them. */
function moneyToPaise(text: string): number | null {
  const match = /₹\s?([\d,]+)(?:\.(\d{2}))?/.exec(text);
  if (!match) return null;
  const rupees = Number((match[1] ?? "0").replace(/,/g, ""));
  if (!Number.isFinite(rupees)) return null;
  const paise = match[2] ? Number(match[2]) : 0;
  return rupees * 100 + paise;
}

async function measureRing(page: Page): Promise<RingGeometry> {
  return await page.evaluate(() => {
    const empty = {
      present: false,
      visible: false,
      viewBox: "",
      scale: 1,
      holeRadius: null,
      holeCentre: null,
      label: null,
      labelInRing: false,
      labelBox: null,
      labelFontPx: null,
      outsideAmount: null,
      outsideFontPx: null,
      captionInRing: false,
      captionBesideAmount: false,
      legendAmounts: [] as string[],
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
    const svg = document.querySelector<SVGSVGElement>(
      'svg[data-testid="owner-mini-donut"]',
    );
    if (!svg) return empty;

    const rect = svg.getBoundingClientRect();
    const style = getComputedStyle(svg);
    const visible =
      rect.width > 0 && rect.height > 0 && style.display !== "none";
    const viewBox = svg.getAttribute("viewBox") ?? "";
    const parts = viewBox.split(/\s+/).map(Number);
    const scale =
      parts.length === 4 && parts[2] > 0 ? rect.width / parts[2] : 1;

    // The ring's own geometry, read from the DOM.
    const group = svg.querySelector("g");
    const ring = group?.querySelector("circle");
    const radius = Number(ring?.getAttribute("r") ?? "");
    const stroke = Number(ring?.getAttribute("stroke-width") ?? "");
    const transform = group?.getAttribute("transform") ?? "";
    const translate =
      /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(transform);
    const holeCentre = translate
      ? { x: Number(translate[1]), y: Number(translate[2]) }
      : null;
    const holeRadius =
      Number.isFinite(radius) && Number.isFinite(stroke)
        ? radius - stroke / 2
        : null;

    // The label: the ring's own centre text, and its ink box.
    const texts = Array.from(svg.querySelectorAll("text"));
    const labelText =
      texts.find((node) => (node.textContent ?? "").includes("₹")) ?? null;
    const captionInRing = texts.some((node) =>
      (node.textContent ?? "").toLowerCase().includes("collected"),
    );
    let labelBox: RingGeometry["labelBox"] = null;
    let labelFontPx: number | null = null;
    if (labelText) {
      const range = document.createRange();
      range.selectNodeContents(labelText);
      const ink = range.getBoundingClientRect();
      labelBox = {
        left: (ink.left - rect.left) / scale,
        top: (ink.top - rect.top) / scale,
        right: (ink.right - rect.left) / scale,
        bottom: (ink.bottom - rect.top) / scale,
      };
      // The painted size: the SVG's font size, scaled by the viewBox.
      const fontSize =
        Number.parseFloat(getComputedStyle(labelText).fontSize) || 0;
      labelFontPx = fontSize * scale;
    }

    // The amount drawn next to the ring, when it is not in the centre.
    let outsideAmount: string | null = null;
    let outsideFontPx: number | null = null;
    const container = svg.parentElement;
    const adjacent = Array.from(
      container?.querySelectorAll<HTMLElement>("p, span") ?? [],
    ).find((element) => {
      const text = (element.textContent ?? "").trim();
      return (
        /^₹\s?[\d,]+(?:\.\d{2})?$/.test(text) &&
        element.getBoundingClientRect().width > 0
      );
    });
    if (adjacent) {
      outsideAmount = (adjacent.textContent ?? "").trim();
      outsideFontPx =
        Number.parseFloat(getComputedStyle(adjacent).fontSize) || null;
    }
    const captionBesideAmount = Array.from(
      container?.querySelectorAll<HTMLElement>("p, span") ?? [],
    ).some((element) =>
      (element.textContent ?? "").toLowerCase().includes("collected"),
    );

    // The legend's own category amounts, in the order it states them.
    const legend = document.querySelector(
      '[data-testid="owner-payment-mix-legend"]',
    );
    const legendAmounts: string[] = [];
    const items = Array.from(
      legend?.querySelectorAll<HTMLElement>(":scope > ul > li") ?? [],
    );
    for (const item of items) {
      const match = /₹\s?[\d,]+(?:\.\d{2})?/.exec(item.textContent ?? "");
      if (match) legendAmounts.push(match[0]);
    }

    return {
      present: true,
      visible,
      viewBox,
      scale,
      holeRadius,
      holeCentre,
      label: labelText?.textContent?.trim() ?? null,
      labelInRing: Boolean(labelText),
      labelBox,
      labelFontPx,
      outsideAmount,
      outsideFontPx,
      captionInRing,
      captionBesideAmount,
      legendAmounts,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
}

function judge(
  geometry: RingGeometry,
  required: boolean,
  requestedTheme: string,
  appliedTheme: string | null,
): { state: Case["state"]; failures: string[] } {
  const failures: string[] = [];
  // The preset the page really rendered must be the one that was
  // asked for: a mislabelled capture is a failed case, never a pass.
  if (appliedTheme !== requestedTheme) {
    failures.push(
      `the page renders the "${appliedTheme ?? "no"}" preset, not the requested "${requestedTheme}"`,
    );
  }
  if (!geometry.present) {
    if (!required) return { state: "not-applicable", failures: [] };
    failures.push(
      "the Home payment mix draws no ring at all on a phone — the populated period was not read",
    );
    return { state: "measured", failures };
  }
  if (!geometry.visible) {
    if (!required) return { state: "not-applicable", failures: [] };
    failures.push(
      "the Home payment-mix ring is present but not visible on a phone",
    );
    return { state: "measured", failures };
  }

  const amount = geometry.labelInRing
    ? geometry.label
    : geometry.outsideAmount;
  if (!amount) {
    failures.push(
      "the payment-mix ring states no total at all, in the centre or next to it",
    );
  } else if (!FULL_INR.test(amount.trim())) {
    failures.push(
      `the total "${amount}" is not a full rupee figure (it must not be truncated, rounded or abbreviated)`,
    );
  }

  if (geometry.labelInRing) {
    if (!geometry.labelBox || !geometry.holeRadius || !geometry.holeCentre) {
      failures.push(
        "the ring's inner circle or the label's ink box could not be measured",
      );
    } else {
      const { left, top, right, bottom } = geometry.labelBox;
      const { x, y } = geometry.holeCentre;
      const radius = geometry.holeRadius;
      const corners = [
        { x: left, y: top },
        { x: right, y: top },
        { x: left, y: bottom },
        { x: right, y: bottom },
      ];
      const worst = corners.reduce((farthest, corner) => {
        const distance = Math.hypot(corner.x - x, corner.y - y);
        return distance > farthest.distance
          ? { distance, corner }
          : farthest;
      }, { distance: 0, corner: corners[0]! });
      if (worst.distance > radius + CONTAINMENT_SLACK) {
        failures.push(
          `the centre label "${geometry.label}" reaches ${worst.distance.toFixed(2)} of the hole's ${radius} units from its centre (corner at ${worst.corner.x.toFixed(2)}, ${worst.corner.y.toFixed(2)}); it paints over the band`,
        );
      }
    }
    if (
      geometry.labelFontPx !== null &&
      geometry.labelFontPx < MIN_READABLE_PX
    ) {
      failures.push(
        `the centre total paints at ${geometry.labelFontPx.toFixed(1)}px; it must stay readable (${MIN_READABLE_PX}px or more)`,
      );
    }
  } else {
    // The amount moved out of the hole: it has to be readable there,
    // and the "collected" caption stays with it — inside the ring or
    // beside the amount.
    if (
      geometry.outsideFontPx !== null &&
      geometry.outsideFontPx < MIN_READABLE_PX
    ) {
      failures.push(
        `the total next to the ring paints at ${geometry.outsideFontPx.toFixed(1)}px; it must stay readable (${MIN_READABLE_PX}px or more)`,
      );
    }
    if (!geometry.captionInRing && !geometry.captionBesideAmount) {
      failures.push(
        "the ring lost its 'collected' caption when the total moved next to it",
      );
    }
  }

  if (geometry.legendAmounts.length > 0 && amount) {
    const total = moneyToPaise(amount);
    const parts = geometry.legendAmounts.reduce((sum, value) => {
      const paise = moneyToPaise(value);
      return sum + (paise ?? 0);
    }, 0);
    if (total !== null && Math.abs(total - parts) > 1) {
      failures.push(
        `the ring's total "${amount}" is not the sum of the legend's categories (${geometry.legendAmounts.join(" + ")})`,
      );
    }
  } else if (required) {
    failures.push(
      "the payment mix states no category amounts, so the ring's total cannot be checked against the legend",
    );
  }

  if (geometry.overflow > 1) {
    failures.push(
      `the page overflows horizontally by ${geometry.overflow}px`,
    );
  }

  return { state: "measured", failures };
}

async function main(): Promise<number> {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const cases: Case[] = [];
  try {
    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          locale: "en-IN",
          timezoneId: "Asia/Kolkata",
          reducedMotion: "reduce",
        });
        await signIn(context);
        // The preset is written AFTER the sign-in: the login route
        // clears the device's theme and facility cookies on success
        // (shared-device privacy), so a cookie written before it is
        // gone by the time the owner page loads — every "theme" really
        // measured Mint.
        await context.addCookies([
          { name: "aqua_theme", value: theme, url: BASE_URL },
        ]);
        const page = await context.newPage();
        let geometry: RingGeometry;
        let appliedTheme: string | null = null;
        try {
          // The populated period: today's collections can be empty, and
          // an empty period proves nothing about the ring.
          await page.goto(`${BASE_URL}/owner?period=month`, {
            waitUntil: "networkidle",
            timeout: 120_000,
          });
          await page
            .locator('[data-testid="owner-payment-mix"]')
            .waitFor({ state: "attached", timeout: 60_000 });
          // The real card, in view, with its fonts loaded.
          await page
            .locator('[data-testid="owner-payment-mix"]')
            .scrollIntoViewIfNeeded()
            .catch(() => {});
          await page
            .evaluate(() => document.fonts?.ready)
            .catch(() => {});
          await page.waitForTimeout(300);
          // The preset the document really carries.
          appliedTheme = await page.evaluate(() =>
            document.documentElement.getAttribute("data-theme"),
          );
          geometry = await measureRing(page);
        } catch (error) {
          geometry = {
            present: false,
            visible: false,
            viewBox: "",
            scale: 1,
            holeRadius: null,
            holeCentre: null,
            label: null,
            labelInRing: false,
            labelBox: null,
            labelFontPx: null,
            outsideAmount: null,
            outsideFontPx: null,
            captionInRing: false,
            captionBesideAmount: false,
            legendAmounts: [],
            overflow: 0,
          };
          const verdict = judge(geometry, viewport.required, theme, appliedTheme);
          cases.push({
            theme,
            viewport: viewport.name,
            required: viewport.required,
            appliedTheme,
            geometry,
            state: verdict.state,
            failures: [
              `the Home page could not be read: ${String(error).slice(0, 400)}`,
              ...verdict.failures,
            ],
          });
          await context.close();
          continue;
        }
        const verdict = judge(geometry, viewport.required, theme, appliedTheme);
        cases.push({
          theme,
          viewport: viewport.name,
          required: viewport.required,
          appliedTheme,
          geometry,
          state: verdict.state,
          failures: verdict.failures,
        });
        await page.screenshot({
          path: join(OUT, `${theme}-${viewport.width}-home-payment-mix.png`),
          fullPage: false,
        });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  writeFileSync(
    join(OUT, "home-donut-hole.json"),
    `${JSON.stringify({ at: new Date().toISOString(), cases }, null, 2)}\n`,
  );

  let failed = false;
  for (const item of cases) {
    if (item.failures.length > 0) {
      failed = true;
      console.log(
        `CHANGES REQUIRED home/${item.theme}/${item.viewport}: ${item.failures.join("; ")}`,
      );
    }
  }
  // The phone cases are required: a run that measured none of them has
  // proved nothing and must not report success.
  for (const theme of THEMES) {
    const phone = cases.find(
      (item) => item.theme === theme && item.required,
    );
    if (!phone || phone.state !== "measured") {
      failed = true;
      console.log(
        `CHANGES REQUIRED home/${theme}: the phone case was not measured (${phone?.state ?? "missing"})`,
      );
    }
  }
  const measured = cases.filter((item) => item.state === "measured").length;
  console.log(
    `home donut hole: ${measured}/${cases.length} measured; ${failed ? "CHANGES REQUIRED" : "PASS"}`,
  );
  return failed ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`HOME DONUT PROBE STOP: ${String(error).slice(0, 800)}`);
    process.exitCode = 1;
  });
