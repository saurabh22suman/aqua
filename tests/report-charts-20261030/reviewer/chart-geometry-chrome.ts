// 30 October 2026 — real Chrome geometry check for the report charts.
//
// This is a REVIEWER-owned browser driver, not a unit test: it renders
// the real components (the same server components the page renders)
// with the real compiled Tailwind CSS, opens them in Chromium and
// measures what the browser actually painted.
//
// Why it exists: a class-name assertion cannot tell a line that was
// painted from a line the browser silently dropped. The first draft of
// the trend drew its line as <polyline points="12%,44 ...">; SVG
// polyline points are numeric coordinate pairs, percentages are not
// allowed there, and Chrome dropped the whole line while the unit
// tests, the dots and the data table all still passed. This driver
// reads the painted geometry (SVGPointList.numberOfItems, the painted
// bounding boxes) so that failure cannot pass again.
//
// Usage:
//   pnpm exec tsx --tsconfig tests/report-charts-20261030/tsconfig.json \
//     tests/report-charts-20261030/reviewer/chart-geometry-chrome.ts
//
// It writes its evidence to docs/design/report-charts-20261030/evidence
// and exits non-zero when a check fails.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

import {
  ColumnChart,
  Donut,
  HorizontalBars,
  LineTrend,
} from "@/components/charts";
import { formatINR } from "@/lib/money/format";

const ROOT = resolve(process.cwd());
const OUT = resolve(ROOT, "docs/design/report-charts-20261030/evidence");

const css = await readFileSafe(resolve(ROOT, "app/globals.css"));
const compiled = await postcss([tailwind()]).process(css, {
  from: resolve(ROOT, "app/globals.css"),
});

const markup = {
  donut: renderToStaticMarkup(
    React.createElement(Donut, {
      ariaLabel: "Members mix by status",
      slices: [
        { label: "Active", value: 32, tone: "stroke-good" },
        { label: "Paused", value: 5, tone: "stroke-warn" },
        { label: "Lapsed", value: 3, tone: "stroke-late" },
      ],
    }),
  ),
  // A ring whose FIRST slice is small: only then does the painted
  // geometry say where the ring starts. A big first slice covers 12
  // o'clock whatever the start angle is, which is why the first draft
  // of this fix (a quarter-turn dash offset) passed every other check.
  donutStart: renderToStaticMarkup(
    React.createElement(Donut, {
      ariaLabel: "Start angle ring",
      slices: [
        { label: "Active", value: 3, tone: "stroke-good" },
        { label: "Paused", value: 2, tone: "stroke-warn" },
        { label: "Lapsed", value: 35, tone: "stroke-late" },
      ],
    }),
  ),
  bars: renderToStaticMarkup(
    React.createElement(HorizontalBars, {
      ariaLabel: "Collections by membership plan",
      valueLabel: (value: number) => formatINR(value),
      rows: [
        {
          label: "Annual Membership",
          value: 200_000,
          hint: "₹2,000.00 across 4 payments",
        },
        {
          label: "Quarterly Membership",
          value: 500_000,
          hint: "₹5,000.00 across 2 payments",
        },
      ],
    }),
  ),
  trend: renderToStaticMarkup(
    React.createElement(LineTrend, {
      ariaLabel: "Attendance percentage by day, 6 days",
      maxValue: 100,
      formatValue: (value: number) => `${value}%`,
      valueTitle: "Percent present or late",
      timeTitle: "Date",
      points: [
        { label: "2026-09-01", value: 75 },
        { label: "2026-09-02", value: 88 },
        { label: "2026-09-03", value: null },
        { label: "2026-09-04", value: 50 },
        { label: "2026-09-05", value: 100 },
        { label: "2026-09-06", value: 0 },
      ],
    }),
  ),
  columns: renderToStaticMarkup(
    React.createElement(ColumnChart, {
      ariaLabel: "Collections by day, 4 days",
      valueLabel: (value: number) => `₹${(value / 100).toFixed(2)}`,
      axisValueLabel: (value: number) => `₹${Math.round(value / 100)}`,
      valueTitle: "INR collected",
      timeTitle: "Date",
      points: [
        { label: "2026-09-01", value: 50_000 },
        { label: "2026-09-02", value: 75_000 },
        { label: "2026-09-03", value: 0 },
        { label: "2026-09-04", value: 25_000 },
      ],
    }),
  ),
};

const html = `<!doctype html>
<html lang="en" data-theme="mint">
<head><meta charset="utf-8"><title>report chart geometry</title>
<style>${compiled.css}</style></head>
<body class="bg-paper">
<div class="p-4">
  <div class="mx-auto" style="max-width:326px" data-slot="mobile">${markup.trend}</div>
  <div class="mx-auto mt-6" style="max-width:507px" data-slot="desktop">${markup.columns}</div>
  <div class="mx-auto mt-6" data-slot="donut">${markup.donut}</div>
  <div class="mx-auto mt-6" data-slot="donut-start">${markup.donutStart}</div>
  <div class="mx-auto mt-6" data-slot="bars">
    <div style="max-width:450px">${markup.bars}</div>
    <div class="mt-4" style="max-width:326px">${markup.bars}</div>
  </div>
</div>
</body></html>`;

// The browser side runs as a string: tsx rewrites named functions with
// __name helpers that do not exist inside the page.
const MEASURE = `(() => {
  const svgOf = (label) => document.querySelector('svg[aria-label*="' + label + '"]');
  const painted = (el) => {
    const box = el.getBBox();
    return { width: box.width, height: box.height, x: box.x, y: box.y };
  };
  const trend = svgOf('Attendance percentage');
  const columns = svgOf('Collections by day');
  const donut = svgOf('mix by status');
  const lines = [...trend.querySelectorAll('line.stroke-water')].map(painted);
  const polylines = [...trend.querySelectorAll('polyline.stroke-water')].map((p) => ({
    points: p.points.numberOfItems,
    painted: painted(p),
  }));
  const dots = [...trend.querySelectorAll('circle.fill-water')].map((c) => ({
    cx: c.getAttribute('cx'),
    painted: painted(c),
  }));
  const texts = [...trend.querySelectorAll('text')].map((t) => ({
    text: t.textContent.trim(),
    fontSize: getComputedStyle(t).fontSize,
    box: t.getBoundingClientRect().toJSON(),
  }));
  const axisColumn = trend.parentElement.parentElement;
  const columnLabels = [...axisColumn.querySelectorAll('span')].map((s) => ({
    text: s.textContent.trim(),
    fontSize: getComputedStyle(s).fontSize,
    box: s.getBoundingClientRect().toJSON(),
  }));
  const donutCircles = [...donut.querySelectorAll('circle')];
  const centre = (el) => {
    const m = el.getCTM();
    const cx = Number(el.getAttribute('cx'));
    const cy = Number(el.getAttribute('cy'));
    return { x: m.a * cx + m.c * cy + m.e, y: m.b * cx + m.d * cy + m.f };
  };
  const track = centre(donutCircles[0]);
  const arcs = donutCircles.slice(1).map((arc) => {
    const c = centre(arc);
    return {
      centre: c,
      error: Math.hypot(c.x - track.x, c.y - track.y),
      stroke: getComputedStyle(arc).stroke,
      transform: getComputedStyle(arc).transform,
    };
  });
  // Where the ring actually starts. The slices tile the whole circle,
  // so the start is the SEAM between the last slice and the first one.
  // A small first slice is used so the seam is unambiguous: just after
  // 12 o'clock must be the FIRST slice, just before it the LAST one.
  // The first draft of this fix (a quarter-turn dash offset) started
  // the ring at 6 o'clock and passed every other check.
  const startSvg = document.querySelector('svg[aria-label="Start angle ring"]');
  const startRect = startSvg.getBoundingClientRect();
  const startCx = startRect.left + startRect.width / 2;
  const startCy = startRect.top + startRect.height / 2;
  const startRadius = 52 * (startRect.width / 132);
  const atAngle = (angleDeg) => {
    const a = (angleDeg * Math.PI) / 180;
    const x = startCx + startRadius * Math.cos(a);
    const y = startCy + startRadius * Math.sin(a);
    const el = document.elementFromPoint(x, y);
    return {
      angleDeg,
      dashed: Boolean(el && el.hasAttribute && el.hasAttribute('stroke-dasharray')),
      cls: el ? el.getAttribute('class') : null,
    };
  };
  const startAngle = { afterTwelve: atAngle(-89), beforeTwelve: atAngle(-91) };
  // The plan bars: the category text must not sit on the bar track,
  // and the exact amount must be readable without hovering anything.
  const barsRoot = document.querySelector('[data-slot="bars"]');
  const barsLabels = Array.from(
    barsRoot.querySelectorAll('text, [data-bar-label]'),
  ).map((el) => {
    const box = el.getBoundingClientRect();
    return { text: el.textContent.trim(), left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  });
  const barsTracks = Array.from(
    barsRoot.querySelectorAll('rect.fill-deck, [data-bar-track]'),
  ).map((el) => {
    const box = el.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  });
  const barsOverlaps = barsLabels.filter((label) =>
    barsTracks.some(
      (track) =>
        label.right > track.left &&
        label.left < track.right &&
        label.bottom > track.top &&
        label.top < track.bottom,
    ),
  ).length;
  const barsVisible = (() => {
    const clone = barsRoot.cloneNode(true);
    clone.querySelectorAll('title').forEach((node) => node.remove());
    return clone.textContent || '';
  })();
  const bars = [...columns.querySelectorAll('rect')].map((r) => ({
    x: r.getAttribute('x'),
    width: r.getAttribute('width'),
    painted: painted(r),
  }));
  const columnTexts = [...columns.querySelectorAll('text')].map((t) => ({
    text: t.textContent.trim(),
    fontSize: getComputedStyle(t).fontSize,
  }));
  const columnAxisLabels = [...columns.parentElement.parentElement.querySelectorAll('span')].map((s) => ({
    text: s.textContent.trim(),
    fontSize: getComputedStyle(s).fontSize,
  }));
  return {
    trend: { lines, polylines, dots, texts, columnLabels },
    columns: { bars, columnTexts, columnAxisLabels },
    donut: { track, arcs, startAngle },
    bars: { labels: barsLabels, tracks: barsTracks, overlaps: barsOverlaps, visible: barsVisible },
  };
})()`;

type Painted = { width: number; height: number; x: number; y: number };
type Measured = {
  trend: {
    lines: Painted[];
    polylines: Array<{ points: number; painted: Painted }>;
    dots: Array<{ cx: string | null; painted: Painted }>;
    texts: Array<{ text: string; fontSize: string; box: DOMRect }>;
    columnLabels: Array<{ text: string; fontSize: string; box: DOMRect }>;
  };
  columns: {
    bars: Array<{ x: string | null; width: string | null; painted: Painted }>;
    columnTexts: Array<{ text: string; fontSize: string }>;
    columnAxisLabels: Array<{ text: string; fontSize: string }>;
  };
  donut: {
    track: { x: number; y: number };
    arcs: Array<{
      centre: { x: number; y: number };
      error: number;
      stroke: string;
      transform: string;
    }>;
    startAngle: {
      afterTwelve: { angleDeg: number; dashed: boolean; cls: string | null };
      beforeTwelve: { angleDeg: number; dashed: boolean; cls: string | null };
    };
  };
  bars: {
    labels: Array<{
      text: string;
      left: number;
      right: number;
      top: number;
      bottom: number;
    }>;
    tracks: Array<{
      left: number;
      right: number;
      top: number;
      bottom: number;
    }>;
    overlaps: number;
    visible: string;
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.setContent(html, { waitUntil: "load" });
const measured = (await page.evaluate(MEASURE)) as Measured;
await page.screenshot({
  path: resolve(OUT, "chart-geometry.png"),
  fullPage: true,
});
await browser.close();

const trend = measured.trend;
const drawnLineWidth = trend.lines.reduce((sum, line) => sum + line.width, 0);
const dotCentres = trend.dots.map((dot) => dot.painted.x + dot.painted.width / 2);
// The painted segment ends, resolved against the recorded dots.
const segmentPairs = trend.lines.map((line) => {
  const nearest = (target: number) => {
    let index = 0;
    let distance = Number.POSITIVE_INFINITY;
    dotCentres.forEach((centre, at) => {
      const gap = Math.abs(centre - target);
      if (gap < distance) {
        distance = gap;
        index = at;
      }
    });
    return { index, distance };
  };
  const from = nearest(line.x + 1.25);
  const to = nearest(line.x + line.width - 1.25);
  return {
    from: from.index,
    to: to.index,
    fromDistance: from.distance,
    toDistance: to.distance,
  };
});
const polylineWidth = trend.polylines.reduce(
  (sum, line) => sum + line.painted.width,
  0,
);
const axisFontSizes = [
  ...trend.texts.map((t) => t.fontSize),
  ...trend.columnLabels.map((t) => t.fontSize),
  ...measured.columns.columnTexts.map((t) => t.fontSize),
  ...measured.columns.columnAxisLabels.map((t) => t.fontSize),
].map((size) => Number.parseFloat(size));
const smallestFont = Math.min(...axisFontSizes);

const checks = [
  {
    name: "trend-line-is-painted",
    pass:
      drawnLineWidth + polylineWidth > 0,
    detail: { drawnLineWidth, polylineWidth },
  },
  {
    name: "no-polyline-with-percentage-points",
    pass: trend.polylines.every((line) => line.points > 0),
    detail: { polylines: trend.polylines },
  },
  {
    name: "gap-stays-a-gap",
    pass: trend.lines.length === 3 && trend.dots.length === 5,
    detail: { segments: trend.lines.length, dots: trend.dots.length },
  },
  {
    // Every painted segment must join the two recorded dots next to it.
    // The dots are looked up by nearest centre, because the segments
    // skip the unrecorded day and so are not the first N pairs of
    // dots. A segment that collapses onto the baseline (the run index
    // bug) ends where no neighbouring dot is.
    name: "segments-join-their-own-dots",
    pass: segmentPairs.every(
      (pair) =>
        pair.to === pair.from + 1 &&
        pair.fromDistance < 4 &&
        pair.toDistance < 4,
    ),
    detail: { segmentPairs, dotCentres },
  },
  {
    name: "axis-labels-are-readable",
    pass: smallestFont >= 11,
    detail: { smallestFont },
  },
  {
    name: "donut-arcs-share-the-track-centre",
    pass: measured.donut.arcs.every((arc) => arc.error < 0.1),
    detail: { arcs: measured.donut.arcs },
  },
  {
    name: "donut-starts-at-twelve-oclock",
    pass:
      measured.donut.startAngle.afterTwelve.dashed === true &&
      measured.donut.startAngle.afterTwelve.cls === "stroke-good" &&
      measured.donut.startAngle.beforeTwelve.cls === "stroke-late",
    detail: { startAngle: measured.donut.startAngle },
  },
  {
    name: "bar-labels-do-not-sit-on-the-track",
    pass: measured.bars.overlaps === 0,
    detail: measured.bars,
  },
  {
    name: "bar-amounts-are-readable-without-hovering",
    pass: measured.bars.visible.includes("₹2,000.00"),
    detail: { visible: measured.bars.visible },
  },
];

const result = {
  at: new Date().toISOString(),
  source: "components/charts/report-*.tsx",
  measured,
  checks,
  status: checks.every((check) => check.pass) ? "PASS" : "CHANGES REQUIRED",
};

await mkdir(OUT, { recursive: true });
await writeFile(
  resolve(OUT, "chart-geometry-chrome.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    status: result.status,
    checks: checks.map((check) => ({
      name: check.name,
      pass: check.pass,
      detail: check.detail,
    })),
  }),
);
if (result.status !== "PASS") process.exitCode = 1;

async function readFileSafe(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}
