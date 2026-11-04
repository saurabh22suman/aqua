#!/usr/bin/env tsx
/**
 * Mobile contract QA driver (reviewer-owned, preparation only).
 *
 * Run with `node --experimental-strip-types`, never tsx: tsx/esbuild
 * keepNames injects `__name` into serialized page.evaluate functions.
 *
 * This driver supplements the existing capture-owner final matrix:
 *   - shared component families across 320/360/375/390/412/430/480
 *   - actual rendered target sizes, label/error associations, overlap,
 *     document overflow, phone charts and local table scrolling
 *   - safe read-only date/filter interactions
 *
 * It refuses to run until SOURCE_READY is recorded in the mobile matrix and
 * the supplied --source-sha matches. No product source is imported or edited.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
// @ts-expect-error — Node strip-types needs the explicit .ts specifier; tsc's bundler resolution rejects it.
import { isMemberDetailPath, normaliseFixtureValue } from "./capture-owner.ts";
import { chromium, type BrowserContext, type Page } from "playwright";

const ROOT = process.cwd();
const OUT_DIR = resolve(
  ROOT,
  process.env.AQUA_E2E_OUT ?? ".playwright-mcp/mobile-qa-default",
);
const MOBILE_DIR = join(
  ROOT,
  "docs/design/owner-openpen-20261029/mobile-20261029",
);
const MATRIX_PATH = join(MOBILE_DIR, "mobile-matrix.json");
const FINAL_MATRIX = join(
  ROOT,
  "docs/design/owner-openpen-20261029/qa/final-matrix.json",
);
const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3275";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const THEMES = ["mint", "lavender"] as const;
type Theme = (typeof THEMES)[number];

type MobileMatrix = {
  status: string;
  sourceReady: { sha256: string; at: string } | null;
  widths: number[];
  sharedRoutes: Array<{ route: string; family: string; fixture: string }>;
  cases: Array<{ id: string; name: string; assertions: string[] }>;
  deviceChecklist: Array<{ id: string; status: string; reason: string }>;
};

type Check = {
  name: string;
  pass: boolean | null;
  detail: string;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
};

export type LabelSources = {
  labelledBy: string;
  ariaLabel: string | null;
  labels: string[];
};

/**
 * Accessible name precedence: aria-labelledby, then aria-label, then the
 * native/explicit label text. A wrapping <label> is a real label, not a
 * missing association.
 */
export function resolveAccessibleLabel(sources: LabelSources): string {
  const normalize = (value: string | null | undefined) =>
    (value ?? "").replace(/\s+/g, " ").trim();
  const labelledBy = normalize(sources.labelledBy);
  if (labelledBy) return labelledBy;
  const aria = normalize(sources.ariaLabel);
  if (aria) return aria;
  return sources.labels.map(normalize).filter(Boolean).join(" ").trim();
}

/** Clip a measured rect to the visible viewport before comparing overlaps. */
export function clipRectToViewport(
  rect: Rect,
  viewport: { width: number; height: number },
): Rect | null {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(viewport.width, rect.right);
  const bottom = Math.min(viewport.height, rect.bottom);
  if (right - left <= 0.5 || bottom - top <= 0.5) return null;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    bottom,
    right,
  };
}

export function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.x, b.x);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
  return Math.max(0, width) * Math.max(0, height);
}

type MobileMeasurement = {
  url: string;
  title: string;
  heading: string;
  theme: string;
  fonts: { instrument: boolean; bricolage: boolean };
  document: {
    clientWidth: number;
    scrollWidth: number;
    horizontalOverflow: number;
    scrollHeight: number;
    innerHeight: number;
  };
  controls: Array<{
    tag: string;
    type: string;
    label: string;
    associatedLabel: boolean;
    describedByResolved: boolean;
    invalid: boolean;
    errorText: string;
    fontSize: number;
    borderRadius: string;
    width: number;
    height: number;
    rect: Rect;
    hitTarget: Rect;
    hitTargetKind: "native" | "label";
  }>;
  targets: {
    visible: number;
    below44: Array<{
      tag: string;
      label: string;
      width: number;
      height: number;
      kind: "native" | "label";
    }>;
    below48: number;
    inputsBelow16: number;
  };
  overlaps: Array<{ first: string; second: string; overlap: number; hit: string }>;
  navOverlaps: Array<{ first: string; second: string; overlap: number; hit: string }>;
  chromeOverlaps: Array<{ first: string; second: string; overlap: number; hit: string }>;
  charts: Array<{ testId: string; role: string; ariaLabel: string; width: number; height: number }>;
  tables: Array<{
    label: string;
    clientWidth: number;
    scrollWidth: number;
    region: string;
    accessible: boolean;
  }>;
  text: {
    hasRupee: boolean;
    mainLength: number;
    memberRows: number;
    moneyText: string;
  };
  timezoneText: string;
  dateInputs: Array<{ id: string; value: string; invalid: boolean; errorText: string }>;
  dialogs: number;
};

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "tel",
  "url",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

export function isTextEntryControl(tag: string, type: string): boolean {
  if (tag === "textarea" || tag === "select") return true;
  return tag === "input" && (type === "" || TEXT_INPUT_TYPES.has(type));
}

export function largestLabelTarget(
  rects: Rect[],
): { rect: Rect; kind: "label" } | null {
  const largest = rects
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return largest ? { rect: largest, kind: "label" } : null;
}

export function meetsMinimumTarget(
  rect: Pick<Rect, "width" | "height">,
  minimum = 44,
): boolean {
  return rect.width >= minimum && rect.height >= minimum;
}

type RawControl = Omit<
  MobileMeasurement["controls"][number],
  "label" | "associatedLabel" | "hitTarget" | "hitTargetKind"
> & { labelSources: LabelSources; labelRect: Rect | null };

type RawMeasurement = Omit<MobileMeasurement, "controls" | "targets"> & {
  controls: RawControl[];
};

export type ObstructionCandidate = {
  text: string;
  overlay: "topbar" | "nav" | "sidebar" | "sticky";
  overlayAfter: "topbar" | "nav" | "sidebar" | "sticky" | "none";
  hit: string;
  pointerInside: boolean;
  focusLanded: boolean;
  disabled: boolean;
};

export type ObstructionAssessment = {
  permanent: ObstructionCandidate[];
  cleared: ObstructionCandidate[];
};

/**
 * A static overlap is only permanent if scrolling and focusing the control
 * still leaves the pointer over another element. Disabled controls cannot
 * receive focus by design, so their pointer clearance is authoritative.
 * Sticky headers can clear; a fixed footer that cannot be scrolled past
 * cannot.
 */
export function assessObstructions(
  candidates: ObstructionCandidate[],
): ObstructionAssessment {
  const permanent: ObstructionCandidate[] = [];
  const cleared: ObstructionCandidate[] = [];
  for (const candidate of candidates) {
    const keyboardOk = candidate.disabled || candidate.focusLanded;
    if (candidate.pointerInside && keyboardOk) cleared.push(candidate);
    else permanent.push(candidate);
  }
  return { permanent, cleared };
}

export type TimeFieldSelectReading = {
  label: string;
  visible: boolean;
  width: number;
  height: number;
  fontSize: number;
  radius: string;
  associated: number;
  hit: string;
  /**
   * The pointer probe answers for the VIEWPORT. `inViewport` records
   * that the probe point really was on screen when the hit was read —
   * `false` means the hit could not have been a fair answer.
   *
   * `focused` records that the control took keyboard focus after it
   * was scrolled into view; `disabled` records a disabled control,
   * which cannot take focus by design.
   *
   * The three are optional so a reading written before this correction
   * still type-checks. A reading that REPORTS them is held to them.
   */
  inViewport?: boolean;
  focused?: boolean;
  disabled?: boolean;
};

export type TimeFieldInteraction = {
  attempted: boolean;
  skippedReason?: string;
  original: string[];
  selected: string[];
  restored: string[];
  ariaInvalidAfter?: string | null;
  error?: string;
};

export type TimeFieldGroupReading = {
  legend: string;
  visible: boolean;
  nativeTimeInputs: number;
  ariaInvalid: string | null;
  ariaRequired: string | null;
  options: {
    hour: string[];
    minute: string[];
    period: string[];
  };
  selects: TimeFieldSelectReading[];
  interaction?: TimeFieldInteraction;
};

export const TIME_FIELD_SELECT_HEIGHT = 48;
export const TIME_FIELD_SELECT_HEIGHT_TOLERANCE = 0.5;
export const TIME_FIELD_SELECT_MIN_WIDTH = 44;

/**
 * The public option set of the shared TimeField control
 * (components/ui/TimeField.tsx): one blank choice, the twelve 12-hour
 * values, the sixty minute values and AM/PM. The oracle compares the
 * RENDERED options with this list, so a control that quietly loses an
 * hour or a minute fails instead of passing on a count alone.
 */
export function expectedTimeFieldOptions(): TimeFieldGroupReading["options"] {
  return {
    hour: ["", ...Array.from({ length: 12 }, (_, index) => String(index + 1))],
    minute: [
      "",
      ...Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0")),
    ],
    period: ["", "AM", "PM"],
  };
}

export function timeFieldOptionsMatch(
  actual: TimeFieldGroupReading["options"],
): boolean {
  const expected = expectedTimeFieldOptions();
  const same = (left: string[], right: string[]) =>
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
  return (
    same(actual.hour, expected.hour) &&
    same(actual.minute, expected.minute) &&
    same(actual.period, expected.period)
  );
}

export function assessTimeFieldGroup(
  reading: TimeFieldGroupReading,
): { pass: boolean; detail: string } {
  const labels = reading.selects.map((select) => select.label).join("/");
  const sizes = reading.selects
    .map(
      (select) =>
        `${select.label}:${select.width}x${select.height}/${select.fontSize}px/${select.radius}/hit=${select.hit}/viewport=${select.inViewport === false ? "no" : "yes"}/focus=${
          select.disabled === true ? "n/a" : select.focused === false ? "no" : "yes"
        }`,
    )
    .join(",");
  const options = timeFieldOptionsMatch(reading.options);
  const interaction = reading.interaction;
  const interactionOk =
    !interaction ||
    !interaction.attempted ||
    (!interaction.error &&
      interaction.selected[0] === "9" &&
      interaction.selected[1] === "30" &&
      interaction.selected[2] === "PM" &&
      interaction.restored.join("|") === interaction.original.join("|"));
  const valid =
    reading.visible &&
    reading.nativeTimeInputs === 0 &&
    reading.selects.length === 3 &&
    labels === "Hour/Minutes/AM/PM" &&
    options &&
    interactionOk &&
    reading.selects.every(
      (select) =>
        select.visible &&
        // The probe point has to be on screen, and the control has to
        // take focus: a control that is only reachable by a pointer
        // that lands on another element is not a usable control.
        select.inViewport !== false &&
        (select.disabled === true || select.focused !== false) &&
        Math.abs(select.height - TIME_FIELD_SELECT_HEIGHT) <=
          TIME_FIELD_SELECT_HEIGHT_TOLERANCE &&
        select.width >= TIME_FIELD_SELECT_MIN_WIDTH &&
        select.fontSize >= 16 &&
        select.radius === "10px" &&
        select.associated >= 1 &&
        select.hit === "select",
    );
  const interactionDetail = interaction
    ? interaction.attempted
      ? `interaction=edited/restored=${interaction.restored.join("|") === interaction.original.join("|")}; selected=${interaction.selected.join("|")}; invalidAfter=${interaction.ariaInvalidAfter ?? "false"}`
      : `interaction=skipped (${interaction.skippedReason ?? "disabled"})`
    : "interaction=not-run";
  const optionDetail = options
    ? "options=match"
    : `options=mismatch(hour=${reading.options.hour.length},minute=${reading.options.minute.length},period=${reading.options.period.length})`;
  return {
    pass: valid,
    detail: `legend="${reading.legend}"; nativeTimeInputs=${reading.nativeTimeInputs}; ariaInvalid=${reading.ariaInvalid ?? "false"} (observed); ariaRequired=${reading.ariaRequired ?? "false"} (observed); ${optionDetail}; selects=${sizes}; ${interactionDetail}`,
  };
}

export type ChartState = {
  charts: MobileMeasurement["charts"];
  moneyText: string;
  period: string;
};

const CHART_EMPTY_COPY =
  /No payments captured in this period|No collections in this period|No attendance marks recorded in this period|there is no mix to draw/i;

function renderedCharts(state: ChartState) {
  return state.charts.filter(
    (chart) =>
      (chart.testId === "owner-mini-chart" ||
        chart.testId === "owner-mini-donut") &&
      chart.width > 1 &&
      chart.height > 1 &&
      chart.ariaLabel.length > 0,
  );
}

/**
 * The default Day can be legitimately empty. In that case the same route's
 * existing Month period is measured; it must render a real non-empty phone
 * chart, or the honest empty-state sentence. No data is fabricated.
 */
export function assessPhoneCharts(
  initial: ChartState,
  monthly: ChartState | null,
): { pass: boolean | null; detail: string } {
  const initialCharts = renderedCharts(initial);
  if (initial.charts.length > 0) {
    return initialCharts.length === initial.charts.length
      ? {
          pass: true,
          detail: `period=${initial.period}; phone charts=${initialCharts.length}`,
        }
      : {
          pass: false,
          detail: `period=${initial.period}; rendered charts invalid; charts=${JSON.stringify(initial.charts)}`,
        };
  }
  if (!monthly) {
    return {
      pass: null,
      detail: `period=${initial.period}; no phone charts; monthly probe unavailable`,
    };
  }
  const monthlyCharts = renderedCharts(monthly);
  if (monthlyCharts.length > 0) {
    return {
      pass: true,
      detail: `period=${initial.period} empty; month charts=${monthlyCharts.length} at ${monthly.period}`,
    };
  }
  if (CHART_EMPTY_COPY.test(monthly.moneyText)) {
    return {
      pass: true,
      detail: `period=${initial.period} empty; month=${monthly.period} has the honest empty state`,
    };
  }
  return {
    pass: false,
    detail: `period=${initial.period} empty; month=${monthly.period} has neither a phone chart nor the empty-state sentence`,
  };
}

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function loadMatrix(): Promise<MobileMatrix> {
  return JSON.parse(await readFile(MATRIX_PATH, "utf8")) as MobileMatrix;
}

function gitValue(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "");
}

export const MEMBER_ROW_LINK_SELECTOR = '[data-testid="member-row"]';

/** The fixture must be the UUID segment, never the captured full href. */
export function normaliseMobileFixture(
  value: string | null | undefined,
): string | null {
  return normaliseFixtureValue(value);
}

export type CalendarFocusTarget = {
  testId: string | null;
  eventId: string | null;
};

export function focusMatchesOpener(
  active: CalendarFocusTarget | null,
  opener: CalendarFocusTarget | null,
): boolean {
  return Boolean(
    active &&
      opener &&
      opener.eventId &&
      active.testId === opener.testId &&
      active.eventId === opener.eventId,
  );
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.toString("ascii", 1, 4) !== "PNG") throw new Error("not a PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function enforceIgnored(): void {
  if (!relative(ROOT, OUT_DIR).startsWith(".playwright-mcp")) {
    throw new Error("Mobile QA evidence must stay under ignored .playwright-mcp/");
  }
}

async function signIn(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator("form button[type=submit]");
    let ready = false;
    for (let attempt = 0; attempt < 8 && !ready; attempt++) {
      await page.fill("#login-phone", PHONE);
      await page.fill("#login-pin", PIN);
      await page.locator("#login-pin").blur();
      ready = await page.evaluate(() => {
        const button = document.querySelector('form button[type="submit"]') as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
      });
      if (!ready) await page.waitForTimeout(750);
    }
    if (!ready) throw new Error("synthetic sign-in did not become ready");
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 45_000 }),
      submit.click(),
    ]);
  } finally {
    await page.close().catch(() => {});
  }
}

async function resolveFixtures(page: Page): Promise<Record<string, string | null>> {
  const sources: Record<string, { from: string; waitFor: string }> = {
    memberId: {
      from: "/owner/members",
      waitFor: '[data-testid="members-list"]',
    },
  };
  const out: Record<string, string | null> = {};
  for (const [key, source] of Object.entries(sources)) {
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE_URL}${source.from}`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await page.locator(source.waitFor).first().waitFor({ state: "visible", timeout: 90_000 });
      const hrefs = await page.$$eval("a[href]", (anchors) =>
        anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
      );
      out[key] =
        hrefs
          .map((href) => {
            try {
              return new URL(href, BASE_URL).pathname;
            } catch {
              return "";
            }
          })
          .map((pathname) => normaliseMobileFixture(pathname))
          .find((value) => value !== null) ?? null;
    } catch {
      out[key] = null;
    }
  }
  return out;
}

function interpolate(template: string, fixtures: Record<string, string | null>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => fixtures[key] ?? "");
}

function unresolved(template: string, fixtures: Record<string, string | null>): string[] {
  return [...template.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1] ?? "")
    .filter((key) => !fixtures[key]);
}

async function measure(page: Page): Promise<MobileMeasurement> {
  const raw = await page.evaluate<RawMeasurement>(() => {
    const round = (value: number) => Math.round(value * 10) / 10;
    const rect = (element: Element): Rect => {
      const box = element.getBoundingClientRect();
      return {
        x: round(box.x),
        y: round(box.y),
        width: round(box.width),
        height: round(box.height),
        bottom: round(box.bottom),
        right: round(box.right),
      };
    };
    const nativeVisibility = (element: Element) => {
      const candidate = element as Element & {
        checkVisibility?: (options?: {
          checkOpacity?: boolean;
          checkVisibilityCSS?: boolean;
        }) => boolean;
      };
      return candidate.checkVisibility
        ? candidate.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          })
        : true;
    };
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        nativeVisibility(element) &&
        box.width > 0 &&
        box.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>("button, input, select, textarea"),
    )
      .filter(visible)
      .map((element) => {
        const style = getComputedStyle(element);
        const describedBy = (element.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .filter(Boolean);
        const errorText = describedBy
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        const box = rect(element);
        const labelsProperty = element as HTMLElement & {
          labels?: NodeListOf<HTMLLabelElement>;
        };
        const labelNodes = new Set<HTMLLabelElement>();
        for (const label of labelsProperty.labels ?? []) labelNodes.add(label);
        if (element.id) {
          for (const label of document.querySelectorAll<HTMLLabelElement>(
            `label[for="${CSS.escape(element.id)}"]`,
          )) {
            labelNodes.add(label);
          }
        }
        const closestLabel = element.closest("label");
        if (closestLabel) labelNodes.add(closestLabel);
        const labels = [...labelNodes]
          .map((label) => (label.textContent ?? "").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        const labelRect =
          [...labelNodes]
            .map((label) => rect(label))
            .sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
        const labelledBy = element.getAttribute("aria-labelledby");
        const labelledByText = labelledBy
          ? labelledBy
              .split(/\s+/)
              .map((token) => document.getElementById(token)?.textContent ?? "")
              .join(" ")
          : "";
        return {
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute("type") ?? "",
          labelSources: {
            labelledBy: labelledByText.trim(),
            ariaLabel: element.getAttribute("aria-label"),
            labels,
          },
          labelRect,
          describedByResolved: describedBy.every((id) => Boolean(document.getElementById(id))),
          invalid: element.getAttribute("aria-invalid") === "true",
          errorText,
          fontSize: parseFloat(style.fontSize) || 0,
          borderRadius: style.borderTopLeftRadius,
          width: box.width,
          height: box.height,
          rect: box,
        };
      });

    const rendered = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return (
        nativeVisibility(element) &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        style.pointerEvents !== "none"
      );
    };
    const clippedRect = (element: HTMLElement): Rect | null => {
      const box = element.getBoundingClientRect();
      let left = Math.max(0, box.left);
      let top = Math.max(0, box.top);
      let right = Math.min(document.documentElement.clientWidth, box.right);
      let bottom = Math.min(window.innerHeight, box.bottom);
      // Fixed elements (and their descendants) are not clipped by ordinary
      // overflow ancestors; their containing block is the viewport.
      let fixedChain = false;
      let fixedNode: HTMLElement | null = element;
      while (fixedNode && fixedNode !== document.body) {
        if (getComputedStyle(fixedNode).position === "fixed") {
          fixedChain = true;
          break;
        }
        fixedNode = fixedNode.parentElement;
      }
      if (!fixedChain) {
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
          const style = getComputedStyle(ancestor);
          const clipX = style.overflowX !== "visible";
          const clipY = style.overflowY !== "visible";
          if (clipX || clipY) {
            const clip = ancestor.getBoundingClientRect();
            if (clipX) {
              left = Math.max(left, clip.left);
              right = Math.min(right, clip.right);
            }
            if (clipY) {
              top = Math.max(top, clip.top);
              bottom = Math.min(bottom, clip.bottom);
            }
          }
          ancestor = ancestor.parentElement;
        }
      }
      if (right - left <= 0.5 || bottom - top <= 0.5) return null;
      return {
        x: round(left),
        y: round(top),
        width: round(right - left),
        height: round(bottom - top),
        bottom: round(bottom),
        right: round(right),
      };
    };
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()}${element.getAttribute("data-testid") ? `[${element.getAttribute("data-testid")}]` : ""}:${(element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30)}`;

    const interactive = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, a[href], input, select, textarea, [data-testid='sticky-action-bar']",
      ),
    )
      .filter(rendered)
      .map((element) => ({ element, rect: clippedRect(element) }))
      .filter((entry): entry is { element: HTMLElement; rect: Rect } => entry.rect !== null);
    const overlaps: Array<{ first: string; second: string; overlap: number; hit: string }> = [];
    const navOverlaps: Array<{ first: string; second: string; overlap: number; hit: string }> = [];
    const chromeOverlaps: Array<{ first: string; second: string; overlap: number; hit: string }> = [];
    for (let first = 0; first < interactive.length; first++) {
      for (let second = first + 1; second < interactive.length; second++) {
        const a = interactive[first];
        const b = interactive[second];
        if (!a || !b || a.element.contains(b.element) || b.element.contains(a.element)) continue;
        const left = Math.max(a.rect.x, b.rect.x);
        const right = Math.min(a.rect.right, b.rect.right);
        const top = Math.max(a.rect.y, b.rect.y);
        const bottom = Math.min(a.rect.bottom, b.rect.bottom);
        const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
        if (overlap <= 16) continue;
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        const hitA = Boolean(hit && (hit === a.element || a.element.contains(hit)));
        const hitB = Boolean(hit && (hit === b.element || b.element.contains(hit)));
        // A third element covering both is not evidence that either action is
        // unreachable; a real overlap has one of the pair on top.
        if (!hitA && !hitB) continue;
        const entry = {
          first: describe(a.element),
          second: describe(b.element),
          overlap: Math.round(overlap),
          hit: hit ? describe(hit) : "none",
        };
        const aNav = Boolean(a.element.closest('[data-testid="owner-mobile-nav"]'));
        const bNav = Boolean(b.element.closest('[data-testid="owner-mobile-nav"]'));
        const aChrome = Boolean(
          a.element.closest(
            '[data-testid="owner-top-bar"], [data-testid="owner-sidebar"], [data-testid="sticky-action-bar"], [data-testid="owner-mobile-nav"]',
          ),
        );
        const bChrome = Boolean(
          b.element.closest(
            '[data-testid="owner-top-bar"], [data-testid="owner-sidebar"], [data-testid="sticky-action-bar"], [data-testid="owner-mobile-nav"]',
          ),
        );
        if (aNav !== bNav) navOverlaps.push(entry);
        else if (aNav && bNav) overlaps.push(entry);
        else if (aChrome || bChrome) chromeOverlaps.push(entry);
        else overlaps.push(entry);
      }
    }

    const charts = ["owner-mini-chart", "owner-mini-donut", "owner-chart"].flatMap((testId) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`))
        .filter(visible)
        .map((chart) => {
          const box = chart.getBoundingClientRect();
          return {
            testId,
            role: chart.getAttribute("role") ?? "",
            ariaLabel: chart.getAttribute("aria-label") ?? "",
            width: round(box.width),
            height: round(box.height),
          };
        }),
    );

    const tables = Array.from(document.querySelectorAll<HTMLTableElement>("table"))
      .filter((table) => table.clientWidth > 0)
      .map((table) => {
        let region: HTMLElement | null = table;
        while (region && region !== document.body) {
          const style = getComputedStyle(region);
          if (style.overflowX === "auto" || style.overflowX === "scroll") break;
          region = region.parentElement;
        }
        return {
          label:
            table.querySelector("caption")?.textContent?.trim() ||
            table.querySelector("th")?.textContent?.trim() ||
            "table",
          clientWidth: table.clientWidth,
          scrollWidth: table.scrollWidth,
          region:
            region && region !== document.body
              ? `${region.tagName.toLowerCase()}${region.getAttribute("data-testid") ? `[${region.getAttribute("data-testid")}]` : ""}`
              : "none",
          accessible: Boolean(
            region &&
              region !== document.body &&
              (region.getAttribute("aria-label") ||
                region.getAttribute("role") === "region" ||
                region.tabIndex >= 0),
          ),
        };
      });

    const main = document.querySelector("main");
    const timezoneText =
      document.body.textContent?.match(/Asia\/Kolkata|IST|timezone|time zone/i)?.[0] ?? "";
    const dateInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"], input[data-testid*="dob"]'),
    ).map((input) => ({
      id: input.id,
      value: input.value,
      invalid: input.getAttribute("aria-invalid") === "true",
      errorText:
        (input.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim(),
    }));

    return {
      url: location.href,
      title: document.title,
      heading: document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      theme: document.documentElement.dataset.theme ?? "",
      fonts: {
        instrument: document.fonts.check('16px "Instrument Sans"'),
        bricolage: document.fonts.check('600 16px "Bricolage Grotesque"'),
      },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
          document.body.scrollWidth - document.documentElement.clientWidth,
        ),
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      },
      controls,
      overlaps,
      navOverlaps,
      chromeOverlaps,
      charts,
      tables,
      text: {
        hasRupee: (main?.innerText ?? "").includes("₹"),
        mainLength: (main?.innerText ?? "").length,
        memberRows: document.querySelectorAll('[data-testid="member-row"]').length,
        moneyText: (
          document.querySelector('[data-testid="owner-home-money"]')?.textContent ?? ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1200),
      },
      timezoneText,
      dateInputs,
      dialogs: document.querySelectorAll("dialog[open]").length,
    };
  });
  const controls: MobileMeasurement["controls"] = raw.controls.map(
    ({ labelSources, labelRect, ...control }) => {
      const label = resolveAccessibleLabel(labelSources);
      const choice =
        control.tag === "input" &&
        (control.type === "checkbox" || control.type === "radio");
      const labelTarget = choice && labelRect
        ? largestLabelTarget([labelRect])
        : null;
      return {
        ...control,
        label,
        associatedLabel: label.length > 0,
        hitTarget: labelTarget?.rect ?? control.rect,
        hitTargetKind: (labelTarget?.kind ?? "native") as "label" | "native",
      };
    },
  );
  return {
    ...raw,
    controls,
    targets: {
      visible: controls.length,
      below44: controls
        .filter((control) => !meetsMinimumTarget(control.hitTarget))
        .map((control) => ({
          tag: control.tag,
          label: control.label,
          width: control.hitTarget.width,
          height: control.hitTarget.height,
          kind: control.hitTargetKind,
        })),
      below48: controls.filter((control) => control.hitTarget.height < 48).length,
      inputsBelow16: controls.filter(
        (control) =>
          isTextEntryControl(control.tag, control.type) &&
          control.fontSize < 16,
      ).length,
    },
  };
}

function evaluateShared(
  measurement: MobileMeasurement,
  theme: Theme,
  route: string,
  probe?: {
    bottom: MobileMeasurement | null;
    monthly: ChartState | null;
    obstructions: ObstructionAssessment | null;
  },
): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean | null, detail: string) =>
    checks.push({ name, pass, detail });
  add(
    "theme-applied",
    measurement.theme === theme,
    `requested=${theme}; rendered=${measurement.theme || "none"}`,
  );
  add(
    "no-document-horizontal-overflow",
    measurement.document.horizontalOverflow === 0,
    `overflow=${measurement.document.horizontalOverflow}px; scrollWidth=${measurement.document.scrollWidth}; clientWidth=${measurement.document.clientWidth}`,
  );
  add(
    "control-targets-at-least-44",
    measurement.targets.below44.length === 0,
    `visible=${measurement.targets.visible}; below44=${measurement.targets.below44.map((item) => `${item.tag}${item.kind === "label" ? "(label)" : ""}:${item.width}x${item.height}`).join(",") || "none"}; below48=${measurement.targets.below48}`,
  );
  add(
    "inputs-at-least-16px",
    measurement.targets.inputsBelow16 === 0,
    `inputs below 16px=${measurement.targets.inputsBelow16}`,
  );
  add(
    "control-radius-10px",
    measurement.controls
      .filter((control) => isTextEntryControl(control.tag, control.type))
      .every((control) => control.borderRadius === "10px"),
    `text-entry radii=${[
      ...new Set(
        measurement.controls
          .filter((control) => isTextEntryControl(control.tag, control.type))
          .map((control) => control.borderRadius),
      ),
    ].join(",") || "none"}`,
  );
  const bottomOverlaps = probe?.bottom?.overlaps ?? [];
  add(
    "no-interactive-overlap",
    measurement.overlaps.length === 0 && bottomOverlaps.length === 0,
    measurement.overlaps.length || bottomOverlaps.length
      ? [
          ...measurement.overlaps.map(
            (item) => `${item.first} x ${item.second}=${item.overlap}px² hit=${item.hit}`,
          ),
          ...bottomOverlaps.map(
            (item) => `at page end: ${item.first} x ${item.second}=${item.overlap}px² hit=${item.hit}`,
          ),
        ].join("; ")
      : `no clipped, hit-tested content/content overlap >16px²; chrome overlaps diagnosed=${measurement.chromeOverlaps.length + (probe?.bottom?.chromeOverlaps.length ?? 0)}`,
  );
  const obstruction = probe?.obstructions ?? null;
  add(
    "fixed-overlay-permanent-obstruction",
    obstruction ? obstruction.permanent.length === 0 : null,
    obstruction
      ? obstruction.permanent.length
        ? `permanent=${obstruction.permanent
            .map(
              (item) =>
                `${item.text} [${item.overlay}] hit=${item.hit}; focus=${item.focusLanded}; pointer=${item.pointerInside}`,
            )
            .join("; ")}; cleared=${obstruction.cleared.length}`
        : `cleared=${obstruction.cleared.length}; no permanently blocked control after scroll/focus`
      : "overlay reachability probe unavailable",
  );
  const unlabeled = measurement.controls.filter(
    (control) =>
      ["input", "select", "textarea"].includes(control.tag) &&
      !control.associatedLabel &&
      control.type !== "hidden",
  );
  add(
    "label-association",
    unlabeled.length === 0,
    unlabeled.length
      ? `unlabeled controls=${unlabeled.map((control) => control.tag).join(",")}`
      : `${measurement.controls.length} visible controls checked`,
  );
  const unresolvedDescription = measurement.controls.filter(
    (control) => !control.describedByResolved,
  );
  add(
    "error-description-association",
    unresolvedDescription.length === 0,
    unresolvedDescription.length
      ? `unresolved aria-describedby=${unresolvedDescription.length}`
      : "all aria-describedby ids resolve",
  );
  const invalidWithoutError = measurement.controls.filter(
    (control) => control.invalid && !control.errorText,
  );
  add(
    "invalid-control-has-error-text",
    invalidWithoutError.length === 0,
    invalidWithoutError.length
      ? `invalid controls without referenced error text=${invalidWithoutError.length}`
      : "no invalid control lacks referenced error text",
  );
  if (route === "/owner") {
    const initialChartState: ChartState = {
      charts: measurement.charts,
      moneyText: measurement.text.moneyText,
      period: new URL(measurement.url).searchParams.get("period") ?? "day",
    };
    const assessment = assessPhoneCharts(
      initialChartState,
      probe?.monthly ?? null,
    );
    add("phone-charts-visible", assessment.pass, assessment.detail);
  }
  const overflowingTables = measurement.tables.filter(
    (table) => table.scrollWidth > table.clientWidth + 1,
  );
  add(
    "table-local-scroll-region",
    overflowingTables.every((table) => table.region !== "none"),
    overflowingTables.length
      ? overflowingTables.map((table) => `${table.label}: region=${table.region}; accessible=${table.accessible}`).join("; ")
      : "no rendered table overflows",
  );
  add(
    "money-context-present-when-money-route",
    /\/(fees|reports|members)/.test(route) ? measurement.text.hasRupee || measurement.text.mainLength > 0 : null,
    `₹=${measurement.text.hasRupee}; mainText=${measurement.text.mainLength}`,
  );
  return checks;
}

async function probePageEnd(page: Page): Promise<MobileMeasurement | null> {
  const originalScroll = await page.evaluate(() => window.scrollY).catch(() => 0);
  try {
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await page.waitForTimeout(350);
    return await measure(page);
  } catch {
    return null;
  } finally {
    await page
      .evaluate((scroll) => window.scrollTo(0, scroll), originalScroll)
      .catch(() => {});
    await page.waitForTimeout(100);
  }
}

async function probeMonthlyCharts(
  page: Page,
  initialUrl: string,
): Promise<ChartState | null> {
  try {
    const url = new URL(initialUrl);
    url.searchParams.set("period", "month");
    url.searchParams.set("trend", "collections");
    await page.goto(url.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.locator('[data-testid="owner-shell"]').waitFor({
      state: "visible",
      timeout: 90_000,
    });
    await page.waitForTimeout(450);
    const measurement = await measure(page);
    return {
      charts: measurement.charts,
      moneyText: measurement.text.moneyText,
      period: new URL(page.url()).searchParams.get("period") ?? "month",
    };
  } catch {
    return null;
  }
}

async function probeObstructions(
  page: Page,
  position: "top" | "bottom",
): Promise<ObstructionCandidate[] | null> {
  const originalScroll = await page.evaluate(() => window.scrollY).catch(() => 0);
  try {
    await page.evaluate((where) => {
      window.scrollTo(
        0,
        where === "bottom" ? document.documentElement.scrollHeight : 0,
      );
    }, position);
    await page.waitForTimeout(250);
    return await page.evaluate(() => {
      const nativeVisibility = (element: Element) => {
        const candidate = element as Element & {
          checkVisibility?: (options?: {
            checkOpacity?: boolean;
            checkVisibilityCSS?: boolean;
          }) => boolean;
        };
        return candidate.checkVisibility
          ? candidate.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            })
          : true;
      };
      const visible = (element: Element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          nativeVisibility(element) &&
          box.width > 0 &&
          box.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      };
      const overlays = (
        [
          ["topbar", document.querySelector('[data-testid="owner-top-bar"]')],
          ["nav", document.querySelector('[data-testid="owner-mobile-nav"] nav')],
          ["sidebar", document.querySelector('[data-testid="owner-sidebar"]')],
          ["sticky", document.querySelector('[data-testid="sticky-action-bar"]')],
        ] as const
      )
        .filter((entry): entry is readonly [ObstructionCandidate["overlay"], HTMLElement] =>
          Boolean(entry[1] && visible(entry[1])),
        )
        .map(([name, element]) => ({
          name,
          element,
          rect: element.getBoundingClientRect(),
        }));
      const intersect = (a: DOMRect, b: DOMRect) => {
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return Math.max(0, width) * Math.max(0, height);
      };
      const content = Array.from(
        document.querySelectorAll<HTMLElement>(
          "button, a[href], input, select, textarea",
        ),
      ).filter(visible);
      const candidates: ObstructionCandidate[] = [];
      for (const element of content) {
        if (overlays.some((overlay) => overlay.element.contains(element))) continue;
        const before = element.getBoundingClientRect();
        const overlay = overlays.find(
          (candidate) => intersect(before, candidate.rect) > 16,
        );
        if (!overlay) continue;
        element.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
        const disabled = Boolean(
          (element as HTMLButtonElement).disabled ||
            element.getAttribute("aria-disabled") === "true",
        );
        if (!disabled) element.focus({ preventScroll: false });
        const after = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          after.left + after.width / 2,
          after.top + after.height / 2,
        );
        const overlayAfter =
          overlays
            .map((candidate) => ({
              name: candidate.name,
              rect: candidate.element.getBoundingClientRect(),
            }))
            .find((candidate) => intersect(after, candidate.rect) > 16)?.name ??
          "none";
        candidates.push({
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50),
          overlay: overlay.name,
          overlayAfter,
          hit: hit ? hit.tagName.toLowerCase() : "none",
          pointerInside: Boolean(
            hit && (hit === element || element.contains(hit)),
          ),
          focusLanded: document.activeElement === element,
          disabled,
        });
        if (candidates.length >= 12) break;
      }
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return candidates;
    });
  } catch {
    return null;
  } finally {
    await page
      .evaluate((scroll) => window.scrollTo(0, scroll), originalScroll)
      .catch(() => {});
    await page.waitForTimeout(100);
  }
}

async function exerciseTimeFieldGroup(
  page: Page,
  selector: string,
): Promise<TimeFieldInteraction> {
  const group = page.locator(selector).first();
  const selects = group.locator("select");
  const count = await selects.count();
  if (count !== 3) {
    return {
      attempted: false,
      skippedReason: `expected 3 selects, found ${count}`,
      original: [],
      selected: [],
      restored: [],
    };
  }
  const original: string[] = [];
  const disabled: boolean[] = [];
  for (let index = 0; index < 3; index++) {
    original.push(await selects.nth(index).inputValue());
    disabled.push(await selects.nth(index).isDisabled());
  }
  if (disabled.some(Boolean)) {
    return {
      attempted: false,
      skippedReason: "disabled",
      original,
      selected: [],
      restored: original,
    };
  }
  const selected: string[] = [];
  const restored: string[] = [];
  let ariaInvalidAfter: string | null = null;
  let error: string | undefined;
  try {
    await selects.nth(0).selectOption("9");
    await selects.nth(1).selectOption("30");
    await selects.nth(2).selectOption("PM");
    await page.waitForTimeout(100);
    for (let index = 0; index < 3; index++) {
      selected.push(await selects.nth(index).inputValue());
    }
    ariaInvalidAfter = await group.getAttribute("aria-invalid");
  } catch (caught) {
    error = String(caught).slice(0, 300);
  } finally {
    for (let index = 2; index >= 0; index--) {
      await selects.nth(index).selectOption(original[index] ?? "").catch(() => {});
    }
    await page.waitForTimeout(100);
    for (let index = 0; index < 3; index++) {
      restored.push(await selects.nth(index).inputValue().catch(() => ""));
    }
  }
  return {
    attempted: true,
    original,
    selected,
    restored,
    ariaInvalidAfter,
    error,
  };
}

async function readTimeFieldGroup(
  page: Page,
  selector: string,
): Promise<TimeFieldGroupReading | null> {
  const group = page.locator(selector).first();
  if ((await group.count()) === 0 || !(await group.isVisible().catch(() => false))) {
    return null;
  }
  return group.evaluate((fieldset) => {
    const visible = (element: Element) => {
      const candidate = element as Element & {
        checkVisibility?: (options?: {
          checkOpacity?: boolean;
          checkVisibilityCSS?: boolean;
        }) => boolean;
      };
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        (candidate.checkVisibility
          ? candidate.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            })
          : true) &&
        box.width > 0 &&
        box.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    // The pointer probe answers for the VIEWPORT, so a group that sits
    // below the fold reads as "no hit" even when the control is
    // perfectly usable. The group is scrolled to the middle of its own
    // scroll container first — the way the obstruction probe clears a
    // sticky bar — and the control is focused the way a keyboard user
    // reaches it. A control that is GENUINELY covered still fails: the
    // hit is read after the scroll and after the focus, never assumed.
    fieldset.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
    return {
      legend: (fieldset.querySelector("legend")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim(),
      visible: visible(fieldset),
      nativeTimeInputs: fieldset.querySelectorAll('input[type="time"]').length,
      ariaInvalid: fieldset.getAttribute("aria-invalid"),
      ariaRequired: fieldset.getAttribute("aria-required"),
      options: {
        hour: Array.from(
          fieldset.querySelectorAll("select")[0]?.querySelectorAll("option") ?? [],
        ).map((option) => option.value),
        minute: Array.from(
          fieldset.querySelectorAll("select")[1]?.querySelectorAll("option") ?? [],
        ).map((option) => option.value),
        period: Array.from(
          fieldset.querySelectorAll("select")[2]?.querySelectorAll("option") ?? [],
        ).map((option) => option.value),
      },
      selects: Array.from(fieldset.querySelectorAll("select")).map((select) => {
        const disabled = (select as HTMLSelectElement).disabled;
        if (!disabled) select.focus({ preventScroll: false });
        const style = getComputedStyle(select);
        const box = select.getBoundingClientRect();
        const centreX = box.left + box.width / 2;
        const centreY = box.top + box.height / 2;
        const inViewport =
          centreX >= 0 &&
          centreY >= 0 &&
          centreX <= document.documentElement.clientWidth &&
          centreY <= window.innerHeight;
        const hit = inViewport
          ? document.elementFromPoint(centreX, centreY)
          : null;
        const labels = (select as HTMLSelectElement).labels;
        return {
          label: (
            select.getAttribute("aria-label") ??
            (labels && labels.length
              ? (labels[0]?.textContent ?? "")
              : "")
          )
            .replace(/\s+/g, " ")
            .trim(),
          visible: visible(select),
          width: Math.round(box.width),
          height: Math.round(box.height),
          fontSize: parseFloat(style.fontSize) || 0,
          radius: style.borderTopLeftRadius,
          associated: labels?.length ?? 0,
          hit: hit ? hit.tagName.toLowerCase() : "none",
          inViewport,
          focused: document.activeElement === select,
          disabled,
        };
      }),
    };
  });
}

type TimeFieldJourney = {
  id: string;
  route: string;
  selector: string;
  open?: (page: Page) => Promise<void>;
};

/**
 * The business-hours control of the locations page. The editor renders
 * one fieldset per OPEN day (`hours-<day>-open` / `hours-<day>-close`),
 * so the journey asks for a specific day instead of any fieldset.
 */
const BUSINESS_HOURS_SELECTOR = 'fieldset[id^="hours-monday-open"]';

const TIME_FIELD_JOURNEYS: TimeFieldJourney[] = [
  {
    id: "batch-create",
    route: "/owner/programs",
    selector: "#batch-create-start",
    open: async (page) => {
      const add = page.locator('[data-testid="add-batch"]');
      if ((await add.count()) > 0) await add.first().click();
    },
  },
  {
    id: "batch-edit",
    route: "/owner/programs",
    selector: '[data-testid^="edit-batch-start-"]:visible',
    open: async (page) => {
      const edit = page.locator(
        '[data-testid="batches-list-mobile"] button[aria-label^="Edit "]',
      );
      if ((await edit.count()) === 0) throw new Error("no mobile batch edit row");
      await edit.first().click();
    },
  },
  {
    id: "reschedule",
    route: "/owner/sessions",
    selector: "#reschedule-start",
    open: async (page) => {
      const manage = page.locator('[data-testid^="manage-session-"]');
      if ((await manage.count()) === 0) throw new Error("no session manage control");
      await manage.first().click();
      await page.locator('[data-testid="selected-session"]').waitFor({ state: "visible", timeout: 30_000 });
      const reschedule = page.locator('[data-testid^="reschedule-open-"]');
      if ((await reschedule.count()) === 0) throw new Error("no reschedule control");
      await reschedule.first().click();
    },
  },
  {
    id: "booking-price",
    route: "/owner/settings/booking-prices",
    selector: '[data-testid="price-rule-start"]',
    open: async (page) => {
      const add = page.locator('[data-testid="booking-price-add"]');
      if ((await add.count()) > 0) await add.first().click();
    },
  },
  {
    id: "business-hours",
    route: "/owner/settings/locations",
    selector: BUSINESS_HOURS_SELECTOR,
    open: async (page) => {
      // The business hours live in the PER-LOCATION card of the
      // locations page (components/settings/location-manager.tsx ->
      // BusinessHoursEditor). The editor loads its own hours after
      // mount and only renders a time control for a day that is OPEN,
      // so a day is opened through its own checkbox when no control
      // exists yet. Nothing is saved: this is the editor's own
      // control, read in the state the owner sees.
      const toggle = page.locator('input[aria-label="monday open"]').first();
      await toggle.waitFor({ state: "visible", timeout: 30_000 });
      if ((await page.locator(BUSINESS_HOURS_SELECTOR).count()) === 0) {
        await toggle.click();
      }
    },
  },
  {
    id: "roster-add-shift",
    route: "/owner/staff/roster",
    selector: "#add-shift-start",
    open: async (page) => {
      const add = page.locator('button[aria-controls="add-shift-editor"]');
      if ((await add.count()) === 0) throw new Error("no add-shift control");
      const expanded = await add.first().getAttribute("aria-expanded");
      if (expanded !== "true") await add.first().click();
    },
  },
  {
    id: "roster-template",
    route: "/owner/staff/roster",
    selector: "#shift-template-start",
    open: async (page) => {
      // The template editor is a <details> island: its content is not
      // rendered until the summary is opened.
      const details = page
        .locator("details")
        .filter({ has: page.locator("#shift-template-start") });
      const summary = details.locator("summary").first();
      await summary.waitFor({ state: "visible", timeout: 30_000 });
      const opened = await details.evaluate(
        (node) => (node as HTMLDetailsElement).open,
      );
      if (!opened) await summary.click();
    },
  },
];

/**
 * The editor is opened by the journey, but the control itself is
 * rendered by the client AFTER that (a dialog, a <details> island, a
 * form that mounts on the next render). The group is therefore waited
 * for as a VISIBLE fieldset: a group that is still missing is an
 * honest UNTESTED, never a silent pass.
 */
async function waitForTimeFieldGroup(
  page: Page,
  selector: string,
): Promise<boolean> {
  const group = page.locator(selector).first();
  try {
    await group.waitFor({ state: "visible", timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

async function captureTimeFieldJourneys(
  context: BrowserContext,
  page: Page,
  themes: Theme[],
): Promise<Array<Record<string, unknown>>> {
  const records: Array<Record<string, unknown>> = [];
  for (const theme of themes) {
    for (const journey of TIME_FIELD_JOURNEYS) {
      const screenshot = join(
        OUT_DIR,
        "behavior",
        theme,
        "390x844",
        `timefield-${journey.id}.png`,
      );
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
        await page.goto(`${BASE_URL}${journey.route}`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await page.locator('[data-testid="owner-shell"]').waitFor({
          state: "visible",
          timeout: 90_000,
        });
        await page.waitForTimeout(350);
        await journey.open?.(page);
        // The editor is opened by the journey; the control inside it is
        // mounted afterwards. Reading it before it exists produced an
        // UNTESTED that said nothing about the product.
        await waitForTimeFieldGroup(page, journey.selector);
        const reading = await readTimeFieldGroup(page, journey.selector);
        if (!reading) {
          records.push({
            caseId: "MOB-05",
            theme,
            width: 390,
            height: 844,
            route: journey.route,
            status: "UNTESTED",
            captured: false,
            tested: [],
            visualReviewed: false,
            visualVerdict: "PENDING",
            screenshot: null,
            checks: [],
            defects: [],
            unavailable: [
              `${journey.id}: TimeField group not visible at ${journey.selector} after the editor was opened`,
            ],
          });
          continue;
        }
        reading.interaction = await exerciseTimeFieldGroup(page, journey.selector);
        const assessment = assessTimeFieldGroup(reading);
        await mkdir(dirname(screenshot), { recursive: true });
        await page.screenshot({
          path: screenshot,
          fullPage: false,
          animations: "disabled",
          caret: "hide",
        });
        records.push({
          caseId: "MOB-05",
          theme,
          width: 390,
          height: 844,
          route: journey.route,
          status: assessment.pass ? "CAPTURED" : "CHANGES REQUIRED",
          captured: true,
          tested: [
            "timefield-group-selects-48",
            "labels-and-association",
            "validity",
            "am-pm",
            "no-native-time-input",
          ],
          visualReviewed: false,
          visualVerdict: "PENDING",
          screenshot: relative(ROOT, screenshot),
          checks: [
            {
              name: "timefield-select-group",
              pass: assessment.pass,
              detail: `${journey.id}: ${assessment.detail}`,
            },
          ],
          defects: assessment.pass
            ? []
            : [`timefield-select-group: ${assessment.detail}`],
          unavailable: [],
        });
      } catch (error) {
        records.push({
          caseId: "MOB-05",
          theme,
          width: 390,
          height: 844,
          route: journey.route,
          status: "UNTESTED",
          captured: false,
          tested: [],
          visualReviewed: false,
          visualVerdict: "PENDING",
          screenshot: null,
          checks: [],
          defects: [],
          unavailable: [`${journey.id}: ${String(error).slice(0, 500)}`],
        });
      }
    }
  }
  return records;
}

async function captureShared(
  context: BrowserContext,
  page: Page,
  matrix: MobileMatrix,
  themes: Theme[],
  widths: number[],
  fixtures: Record<string, string | null>,
): Promise<Array<Record<string, unknown>>> {
  const records: Array<Record<string, unknown>> = [];
  for (const theme of themes) {
    for (const width of widths) {
      for (const route of matrix.sharedRoutes) {
        const target = interpolate(route.route, fixtures);
        const missing = unresolved(route.route, fixtures);
        const screenshot = join(OUT_DIR, "shared", theme, `${width}x844`, `${safeName(route.route)}.png`);
        const checks: Check[] = [];
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        const onConsole = (message: { type: () => string; text: () => string }) => {
          if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
        };
        const onPageError = (error: Error) => pageErrors.push(error.message.slice(0, 500));
        page.on("console", onConsole);
        page.on("pageerror", onPageError);
        try {
          if (missing.length) {
            records.push({
              caseId: "MOB-02",
              theme,
              width,
              height: 844,
              route: route.route,
              status: "BLOCKED",
              captured: false,
              tested: [],
              visualReviewed: false,
              visualVerdict: "PENDING",
              screenshot: null,
              checks: [{ name: "fixture-resolved", pass: false, detail: missing.join(",") }],
              defects: [`fixture unresolved: ${missing.join(",")}`],
              unavailable: [],
              consoleErrors,
              pageErrors,
            });
            continue;
          }
          await page.setViewportSize({ width, height: 844 });
          await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
          const response = await page.goto(`${BASE_URL}${target}`, {
            waitUntil: "domcontentloaded",
            timeout: 90_000,
          });
          await page.locator('[data-testid="owner-shell"]').waitFor({ state: "visible", timeout: 90_000 });
          await page.locator("main h1").first().waitFor({ state: "visible", timeout: 90_000 });
          await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
          await page.waitForTimeout(450);
          const measurement = await measure(page);
          await mkdir(dirname(screenshot), { recursive: true });
          await page.screenshot({
            path: screenshot,
            fullPage: false,
            animations: "disabled",
            caret: "hide",
          });
          const bytes = await readFile(screenshot);
          const bottomProbe = await probePageEnd(page);
          const topHasOverlap =
            measurement.chromeOverlaps.length > 0 ||
            measurement.navOverlaps.length > 0;
          const bottomHasOverlap = Boolean(
            bottomProbe &&
              (bottomProbe.chromeOverlaps.length > 0 ||
                bottomProbe.navOverlaps.length > 0),
          );
          const topObstructions = topHasOverlap
            ? await probeObstructions(page, "top")
            : [];
          const bottomObstructions = bottomHasOverlap
            ? await probeObstructions(page, "bottom")
            : [];
          const obstruction =
            topObstructions === null || bottomObstructions === null
              ? null
              : assessObstructions([
                  ...topObstructions,
                  ...bottomObstructions,
                ]);
          const hasRenderedPhoneChart = measurement.charts.some(
            (chart) =>
              (chart.testId === "owner-mini-chart" ||
                chart.testId === "owner-mini-donut") &&
              chart.width > 1 &&
              chart.height > 1 &&
              chart.ariaLabel.length > 0,
          );
          const monthlyProbe =
            route.route === "/owner" && !hasRenderedPhoneChart
              ? await probeMonthlyCharts(page, measurement.url)
              : null;
          checks.push(
            ...evaluateShared(measurement, theme, route.route, {
              bottom: bottomProbe,
              monthly: monthlyProbe,
              obstructions: obstruction,
            }),
          );
          checks.unshift({
            name: "http-route-ok",
            pass: (response?.status() ?? 500) < 400,
            detail: `HTTP ${response?.status() ?? "no response"}`,
          });
          checks.unshift({
            name: "shell-and-heading",
            pass: Boolean(measurement.heading) && measurement.document.scrollHeight > 0,
            detail: `h1="${measurement.heading}"; scrollHeight=${measurement.document.scrollHeight}`,
          });
          const defects = checks
            .filter((check) => check.pass === false)
            .map((check) => `${check.name}: ${check.detail}`);
          records.push({
            caseId: "MOB-02",
            theme,
            width,
            height: 844,
            route: route.route,
            url: target,
            status: defects.length ? "CHANGES REQUIRED" : "CAPTURED",
            captured: true,
            tested: checks.filter((check) => check.pass !== null).map((check) => check.name),
            visualReviewed: false,
            visualVerdict: "PENDING",
            screenshot: relative(ROOT, screenshot),
            screenshotSize: pngSize(bytes),
            checks,
            defects,
            unavailable: checks.filter((check) => check.pass === null).map((check) => check.name),
            measurement,
            consoleErrors,
            pageErrors,
          });
        } catch (error) {
          records.push({
            caseId: "MOB-02",
            theme,
            width,
            height: 844,
            route: route.route,
            status: "BLOCKED",
            captured: false,
            tested: [],
            visualReviewed: false,
            visualVerdict: "PENDING",
            screenshot: null,
            checks,
            defects: [String(error).slice(0, 700)],
            unavailable: [],
            measurement: null,
            consoleErrors,
            pageErrors,
          });
        } finally {
          page.off("console", onConsole);
          page.off("pageerror", onPageError);
        }
      }
    }
  }
  return records;
}

async function captureBehavior(
  context: BrowserContext,
  page: Page,
  themes: Theme[],
): Promise<Array<Record<string, unknown>>> {
  const records: Array<Record<string, unknown>> = [];
  for (const theme of themes) {
    // DateField invalid/valid/ISO paste; no save.
    for (const [width, height] of [[390, 844], [1280, 900]] as Array<[number, number]>) {
      const screenshot = join(OUT_DIR, "behavior", theme, `${width}x${height}`, "date-field.png");
      const checks: Check[] = [];
      try {
        await page.setViewportSize({ width, height });
        await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
        await page.goto(`${BASE_URL}/owner/members/new`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await page.locator('[data-testid="member-dob"]').waitFor({ state: "visible", timeout: 90_000 });
        const dob = page.locator('[data-testid="member-dob"]');
        await dob.fill("31/02/2026");
        await dob.blur();
        await page.waitForTimeout(250);
        const invalid = await dob.getAttribute("aria-invalid");
        const invalidMeasurement = await measure(page);
        const invalidHasError = invalidMeasurement.controls.some(
          (control) => control.invalid && control.errorText.length > 0,
        );
        checks.push({
          name: "invalid-date-announced",
          pass: invalid === "true" && invalidHasError,
          detail: `aria-invalid=${invalid}; referenced error text=${invalidHasError}`,
        });
        await dob.fill("2026-10-10");
        await dob.blur();
        await page.waitForTimeout(200);
        const validValue = await dob.inputValue();
        checks.push({
          name: "iso-paste-roundtrip",
          pass: validValue === "10/10/2026",
          detail: `value after ISO paste="${validValue}"`,
        });
        await mkdir(dirname(screenshot), { recursive: true });
        await page.screenshot({
          path: screenshot,
          fullPage: false,
          animations: "disabled",
          caret: "hide",
        });
        records.push({
          caseId: "MOB-06",
          theme,
          width,
          height,
          route: "/owner/members/new",
          status: checks.some((check) => check.pass === false) ? "CHANGES REQUIRED" : "CAPTURED",
          captured: true,
          tested: checks.filter((check) => check.pass !== null).map((check) => check.name),
          visualReviewed: false,
          visualVerdict: "PENDING",
          screenshot: relative(ROOT, screenshot),
          checks,
          defects: checks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`),
          unavailable: [],
        });
      } catch (error) {
        records.push({
          caseId: "MOB-06",
          theme,
          width,
          height,
          route: "/owner/members/new",
          status: "BLOCKED",
          captured: false,
          tested: [],
          visualReviewed: false,
          visualVerdict: "PENDING",
          screenshot: null,
          checks,
          defects: [String(error).slice(0, 700)],
          unavailable: [],
        });
      }
    }

    // Filter/list restoration: safe read-only search/open/back.
    for (const [width, height] of [[390, 844], [1280, 900]] as Array<[number, number]>) {
      const screenshot = join(OUT_DIR, "behavior", theme, `${width}x${height}`, "filter-restore.png");
      const checks: Check[] = [];
      try {
        await page.setViewportSize({ width, height });
        await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
        await page.goto(`${BASE_URL}/owner/members`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await page.locator('[data-testid="members-list"]').waitFor({ state: "visible", timeout: 90_000 });
        const search = page.locator('[data-testid="members-search"]').first();
        await search.fill("a");
        await page.waitForTimeout(700);
        const before = await search.inputValue();
        await Promise.all([
          page.waitForURL((url) => isMemberDetailPath(url.pathname), {
            timeout: 90_000,
          }),
          page.locator(MEMBER_ROW_LINK_SELECTOR).first().click(),
        ]);
        await page.locator("main h1").first().waitFor({ state: "visible", timeout: 90_000 });
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 90_000 });
        await page
          .waitForURL((url) => url.pathname === "/owner/members", {
            timeout: 90_000,
          })
          .catch(() => null);
        await page.locator('[data-testid="members-list"]').waitFor({ state: "visible", timeout: 90_000 });
        await page.waitForTimeout(600);
        const after = await page.locator('[data-testid="members-search"]').first().inputValue();
        checks.push({
          name: "member-search-restored-after-back",
          pass: before === "a" && after === "a",
          detail: `before="${before}"; after="${after}"`,
        });
        await mkdir(dirname(screenshot), { recursive: true });
        await page.screenshot({
          path: screenshot,
          fullPage: false,
          animations: "disabled",
          caret: "hide",
        });
        records.push({
          caseId: "MOB-09",
          theme,
          width,
          height,
          route: "/owner/members",
          status: checks.some((check) => check.pass === false) ? "CHANGES REQUIRED" : "CAPTURED",
          captured: true,
          tested: checks.map((check) => check.name),
          visualReviewed: false,
          visualVerdict: "PENDING",
          screenshot: relative(ROOT, screenshot),
          checks,
          defects: checks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`),
          unavailable: [],
        });
      } catch (error) {
        records.push({
          caseId: "MOB-09",
          theme,
          width,
          height,
          route: "/owner/members",
          status: "BLOCKED",
          captured: false,
          tested: [],
          visualReviewed: false,
          visualVerdict: "PENDING",
          screenshot: null,
          checks,
          defects: [String(error).slice(0, 700)],
          unavailable: [],
        });
      }
    }
  }

  // Calendar event detail is a real shared Dialog: open, Escape, focus
  // restoration and reopen. It is read-only and task-specific; it also exposes
  // the visible range/timezone context for MOB-07. Native OS date pickers are
  // still NOT TESTED (headless cannot prove them).
  for (const theme of themes) {
    for (const [width, height] of [[390, 844], [1280, 900]] as Array<[number, number]>) {
      const screenshot = join(OUT_DIR, "behavior", theme, `${width}x${height}`, "dialog-timezone.png");
      const checks: Check[] = [];
      try {
        await page.setViewportSize({ width, height });
        await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
        await page.goto(`${BASE_URL}/owner/schedule`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await page.locator('[data-testid="owner-shell"]').waitFor({ state: "visible", timeout: 90_000 });
        await page.waitForTimeout(500);
        const range = await page
          .locator('[data-testid="calendar-range"]')
          .innerText()
          .catch(() => "");
        const timezone = await page.evaluate(() => document.body.textContent ?? "");
        checks.push({
          name: "schedule-range-and-timezone-visible",
          pass:
            range.trim().length > 0 &&
            /Asia\/Kolkata|IST|GMT|timezone|time zone/i.test(timezone),
          detail: `range="${range.replace(/\s+/g, " ").slice(0, 160)}"; timezoneText=${/Asia\/Kolkata|IST|GMT|timezone|time zone/i.test(timezone)}`,
        });
        const opener = await page.evaluate<CalendarFocusTarget | null>(() => {
          const nodes = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-testid="calendar-event"], [data-testid="calendar-agenda-item"]',
            ),
          );
          // The same event is rendered twice: the phone agenda and the
          // desktop calendar grid, which keeps a companion list of
          // short events. Only one of the two is on screen at a time,
          // and the hidden one comes FIRST in the DOM — so a bounding
          // box alone also counts the hidden duplicate and the driver
          // would click an element that cannot be clicked. The opener
          // is the first one that is REALLY visible.
          const visible = (element: HTMLElement) => {
            const candidate = element as Element & {
              checkVisibility?: (options?: {
                checkOpacity?: boolean;
                checkVisibilityCSS?: boolean;
              }) => boolean;
            };
            const box = element.getBoundingClientRect();
            return (
              (candidate.checkVisibility
                ? candidate.checkVisibility({
                    checkOpacity: true,
                    checkVisibilityCSS: true,
                  })
                : true) &&
              box.width > 0 &&
              box.height > 0
            );
          };
          const found = nodes.find(visible);
          if (!found) return null;
          return {
            testId: found.getAttribute("data-testid"),
            eventId: found.getAttribute("data-event-id"),
          };
        });
        const clicked = Boolean(opener?.testId && opener.eventId);
        checks.push({
          name: "calendar-event-available",
          pass: clicked,
          detail: clicked
            ? `opener=${opener?.testId}[data-event-id=${opener?.eventId}]`
            : "no visible calendar event",
        });
        if (clicked && opener?.testId && opener.eventId) {
          const openerSelector = `[data-testid="${opener.testId}"][data-event-id="${opener.eventId}"]`;
          // Only the VISIBLE copy of that event can be clicked: the
          // hidden duplicate is earlier in the DOM and swallows the
          // click. The event identity is unchanged — the locator still
          // asks for the same data-event-id — so the focus-return
          // evidence below is about the same event.
          const openerLocator = page.locator(`${openerSelector}:visible`);
          await openerLocator
            .first()
            .waitFor({ state: "visible", timeout: 15_000 });
          await openerLocator.first().click();
          await page.locator("dialog[open]").waitFor({ state: "visible", timeout: 10_000 });
          await page
            .locator('dialog[open] [data-testid="calendar-detail"]')
            .waitFor({ state: "visible", timeout: 10_000 });
          checks.push({
            name: "dialog-opens",
            pass: true,
            detail: "calendar event detail opened",
          });
          await page.keyboard.press("Escape");
          await page.locator("dialog[open]").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(250);
          const closed = (await page.locator("dialog[open]").count()) === 0;
          const active = await page.evaluate<CalendarFocusTarget | null>(() => {
            const element = document.activeElement as HTMLElement | null;
            return element
              ? {
                  testId: element.getAttribute("data-testid"),
                  eventId: element.getAttribute("data-event-id"),
                }
              : null;
          });
          const focusRestored = focusMatchesOpener(active, opener);
          checks.push({
            name: "dialog-escape-closes",
            pass: closed,
            detail: `open dialogs after Escape=${await page.locator("dialog[open]").count()}`,
          });
          checks.push({
            name: "dialog-focus-restored",
            pass: focusRestored,
            detail: `opener=${opener.testId}[data-event-id=${opener.eventId}]; activeElement=${active ? `${active.testId ?? "none"}[data-event-id=${active.eventId ?? "none"}]` : "none"}`,
          });
          await openerLocator.first().click();
          await page
            .locator('dialog[open] [data-testid="calendar-detail"]')
            .waitFor({ state: "visible", timeout: 10_000 });
          const reopened = await page
            .locator('[data-testid="calendar-detail"]')
            .isVisible()
            .catch(() => false);
          checks.push({
            name: "dialog-reopens",
            pass: reopened,
            detail: `calendar detail visible after reopen=${reopened}`,
          });
          await mkdir(dirname(screenshot), { recursive: true });
          await page.screenshot({
            path: screenshot,
            fullPage: false,
            animations: "disabled",
            caret: "hide",
          });
          await page.keyboard.press("Escape");
        }
        records.push({
          caseId: "MOB-10",
          theme,
          width,
          height,
          route: "/owner/schedule",
          status: checks.some((check) => check.pass === false)
            ? "CHANGES REQUIRED"
            : checks.some((check) => check.pass === null)
              ? "UNTESTED"
              : "CAPTURED",
          captured: true,
          tested: checks.filter((check) => check.pass !== null).map((check) => check.name),
          visualReviewed: false,
          visualVerdict: "PENDING",
          screenshot: relative(ROOT, screenshot),
          checks,
          defects: checks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`),
          unavailable: checks.filter((check) => check.pass === null).map((check) => check.name),
        });
        // MOB-07 reuses the same rendered range/timezone evidence.
        records.push({
          caseId: "MOB-07",
          theme,
          width,
          height,
          route: "/owner/schedule",
          status: checks[0]?.pass === false ? "CHANGES REQUIRED" : "CAPTURED",
          captured: true,
          tested: checks[0] ? [checks[0].name] : [],
          visualReviewed: false,
          visualVerdict: "PENDING",
          screenshot: relative(ROOT, screenshot),
          checks: checks[0] ? [checks[0]] : [],
          defects: checks[0]?.pass === false ? [`schedule-range-and-timezone-visible: ${checks[0].detail}`] : [],
          unavailable: [],
        });
      } catch (error) {
        records.push({
          caseId: "MOB-10",
          theme,
          width,
          height,
          route: "/owner/schedule",
          status: "UNTESTED",
          captured: false,
          tested: [],
          visualReviewed: false,
          visualVerdict: "PENDING",
          screenshot: null,
          checks,
          defects: [],
          unavailable: [String(error).slice(0, 700)],
        });
      }
    }
  }
  return records;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const matrix = await loadMatrix();
  if (args.includes("--check-matrix")) {
    const final = JSON.parse(await readFile(FINAL_MATRIX, "utf8")) as { views: unknown[] };
    const problems: string[] = [];
    if (matrix.status !== "prepared") problems.push(`status=${matrix.status}`);
    if (matrix.sourceReady !== null) problems.push("sourceReady must be null at preparation time");
    for (const width of [320, 360, 375, 390, 412, 430, 480]) {
      if (!matrix.widths.includes(width)) problems.push(`missing width ${width}`);
    }
    if (final.views.length !== 49) problems.push(`final views=${final.views.length}`);
    if (matrix.cases.length < 12) problems.push(`cases=${matrix.cases.length}`);
    for (const entry of matrix.cases) {
      if (!entry.assertions.length) problems.push(`${entry.id} has no assertions`);
    }
    for (const entry of matrix.deviceChecklist) {
      if (!["NOT TESTED", "BLOCKED"].includes(entry.status)) {
        problems.push(`${entry.id} must remain NOT TESTED/BLOCKED`);
      }
    }
    console.log(
      JSON.stringify(
        {
          status: matrix.status,
          widths: matrix.widths,
          sharedRoutes: matrix.sharedRoutes.length,
          sharedCaptures: matrix.sharedRoutes.length * matrix.widths.length * 2,
          cases: matrix.cases.length,
          deviceChecks: matrix.deviceChecklist.length,
          finalViews: final.views.length,
          issues: problems,
          sourceReady: matrix.sourceReady,
        },
        null,
        2,
      ),
    );
    return problems.length ? 1 : 0;
  }

  if (!args.includes("--final")) {
    throw new Error("pass --check-matrix or --final --group shared|behavior --source-sha <hash>");
  }
  const supplied = argValue(args, "--source-sha") ?? "";
  if (!matrix.sourceReady || supplied !== matrix.sourceReady.sha256) {
    throw new Error(
      "Refusing mobile final capture: SOURCE_READY hash is not recorded in mobile-matrix.json or does not match.",
    );
  }
  enforceIgnored();
  const group = argValue(args, "--group") ?? "shared";
  if (!["shared", "behavior"].includes(group)) {
    throw new Error(`unknown mobile group ${group}`);
  }
  const themes = THEMES.filter((theme) =>
    argValue(args, "--theme") ? argValue(args, "--theme") === theme : true,
  );
  const widths = argValue(args, "--widths")
    ? (argValue(args, "--widths") ?? "").split(",").map(Number)
    : matrix.widths;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    acceptDownloads: false,
  });
  const page = await context.newPage();
  try {
    await signIn(context);
    const fixtures = await resolveFixtures(page);
    const records =
      group === "shared"
        ? await captureShared(context, page, matrix, themes, widths, fixtures)
        : [
            ...(await captureBehavior(context, page, themes)),
            ...(await captureTimeFieldJourneys(context, page, themes)),
          ];
    const defects = records.flatMap((record) =>
      Array.isArray(record.defects) ? record.defects : [],
    );
    const summary = {
      driver: "mobile-qa",
      group,
      sourceReady: supplied,
      capturedAt: new Date().toISOString(),
      app: {
        baseUrl: BASE_URL,
        head: gitValue(["rev-parse", "HEAD"]),
        branch: gitValue(["branch", "--show-current"]),
        outputRoot: OUT_DIR,
      },
      themes,
      widths,
      fixtures,
      records,
      summary: {
        records: records.length,
        captured: records.filter((record) => record.captured === true).length,
        changesRequired: records.filter((record) => record.status === "CHANGES REQUIRED").length,
        blocked: records.filter((record) => record.status === "BLOCKED").length,
        untested: records.filter((record) => record.status === "UNTESTED").length,
        visualReviewed: 0,
        visualPending: records.length,
      },
      defects,
      notes: [
        "visualReviewed=false everywhere; no visual PASS is claimed.",
        "Actual Xiaomi/PWA/OS keyboard/real zoom/text/AT remain NOT TESTED.",
        "No save/send/payment/credential action was performed.",
      ],
    };
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      join(OUT_DIR, `summary-${group}-${themes.join("-")}.json`),
      JSON.stringify(summary, null, 2) + "\n",
    );
    console.log(
      `mobile ${group}: ${summary.summary.captured}/${summary.summary.records} captured; ` +
        `${summary.summary.changesRequired} CHANGES REQUIRED; ${summary.summary.blocked} BLOCKED; ` +
        `${summary.summary.untested} UNTESTED`,
    );
    return summary.summary.changesRequired || summary.summary.blocked ? 1 : 0;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`MOBILE QA STOP: ${String(error).slice(0, 1200)}`);
      process.exitCode = 1;
    });
}
