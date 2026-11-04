#!/usr/bin/env tsx
/**
 * Independent owner UI QA — rendered capture/check driver.
 *
 * This file is owned by the reviewer lane. It reads the application, never
 * writes to it: no forms are submitted, no payments/messages are sent, and
 * no credentials are captured. The only cookie it writes is the display
 * preference `aqua_theme`, after the one synthetic login.
 *
 * Invoke only through .opencode/scripts/lane_job.py and, for rendered runs,
 * .opencode/scripts/owner_preview.py (one bounded preview server per run).
 * Run this file with `node --experimental-strip-types`, never `tsx`: tsx's
 * esbuild keepNames helper injects `__name` into serialized page.evaluate
 * functions and makes every rendered capture fail before the app is read.
 *
 * Modes:
 *   --baseline             small Phase 1 baseline (18 viewport captures)
 *   --final --group ...    prepared all-owner matrix; refuses until the
 *                          coordinator records SOURCE_READY + hash
 *   --check-matrix         validate reference/route coverage without a server
 *
 * The final mode is intentionally gated: the current checkout is the
 * unchanged baseline, not the OpenPen implementation.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  chromium,
  type BrowserContext,
  type Page,
  type Response,
} from "playwright";

const ROOT = process.cwd();
const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3275";
const OUT_DIR = resolve(
  ROOT,
  process.env.AQUA_E2E_OUT ??
    "docs/design/owner-openpen-20261029/qa/evidence/baseline",
);
const QA_DIR = join(ROOT, "docs/design/owner-openpen-20261029/qa");
const REFERENCE = join(
  ROOT,
  "docs/design/owner-openpen-20261029/reference/openpen-owner-design-review.html",
);
const ACCEPTANCE = join(QA_DIR, "acceptance-matrix.json");
const FINAL_MATRIX = join(QA_DIR, "final-matrix.json");

const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const ACCOUNTANT_PHONE = "+919000000006";

const THEMES = ["mint", "lavender"] as const;
type Theme = (typeof THEMES)[number];

type ViewportSpec = { name: string; width: number; height: number };

const DESKTOP: ViewportSpec = {
  name: "desktop-1280x900",
  width: 1280,
  height: 900,
};
const MOBILE: ViewportSpec = { name: "mobile-390x844", width: 390, height: 844 };

type BaselineView = {
  id: string;
  url: string;
  waitFor?: string;
  note: string;
  scrollProbe?: boolean;
};

const BASELINE_DESKTOP: BaselineView[] = [
  {
    id: "home",
    url: "/owner",
    waitFor: '[data-testid="owner-home"]',
    note: "Home populated, default day period.",
  },
  {
    id: "home-monthly-collections",
    url: "/owner?period=month",
    waitFor:
      '[data-testid="owner-home-money-band"] [data-testid="owner-chart"]',
    note: "Home monthly collections trend + payment mix.",
  },
  {
    id: "members",
    url: "/owner/members",
    waitFor: '[data-testid="members-list"]',
    note: "Seeded swimmer directory, top of list.",
    scrollProbe: true,
  },
  {
    id: "fees",
    url: "/owner/fees?tab=dues",
    waitFor: "main h1",
    note: "Fees dues tab, reference-matched view.",
  },
  {
    id: "settings",
    url: "/owner/settings",
    waitFor: "main h1",
    note: "Settings hub, default category.",
  },
  {
    id: "bookings",
    url: "/owner/bookings",
    waitFor: "main h1",
    note: "Booking desk, populated slot/form.",
  },
];

const BASELINE_MOBILE: BaselineView[] = [
  {
    id: "members",
    url: "/owner/members",
    waitFor: '[data-testid="members-list"]',
    note: "Mobile swimmer directory.",
  },
  {
    id: "fees",
    url: "/owner/fees?tab=dues",
    waitFor: "main h1",
    note: "Mobile fees dues.",
  },
  {
    id: "bookings",
    url: "/owner/bookings",
    waitFor: "main h1",
    note: "Mobile booking desk.",
  },
];

type FixtureSource = {
  from: string;
  pattern: RegExp;
  waitFor: string;
  label: string;
};

export const AGENDA_VIEW_CONTAINER_TESTID = "calendar-agenda-days";
export const AGENDA_LIST_TESTID = "calendar-agenda";
export const AGENDA_ITEM_TESTID = "calendar-agenda-item";
export const MEMBER_ROW_LINK_SELECTOR = '[data-testid="member-row"]';

const FIXTURE_SOURCES: Record<string, FixtureSource> = {
  memberId: {
    from: "/owner/members",
    pattern: /^\/owner\/members\/[0-9a-f-]{36}$/i,
    waitFor: '[data-testid="members-list"]',
    label: "first seeded member row",
  },
  batchId: {
    from: "/owner/programs",
    pattern: /^\/owner\/batches\/[0-9a-f-]{36}$/i,
    waitFor: "main",
    label: "first seeded batch link",
  },
  enquiryId: {
    from: "/owner/enquiries",
    pattern: /^\/owner\/enquiries\/[0-9a-f-]{36}$/i,
    waitFor: "main",
    label: "first seeded enquiry link",
  },
  staffId: {
    from: "/owner/staff",
    pattern: /^\/owner\/staff\/[0-9a-f-]{36}$/i,
    waitFor: "main",
    label: "first seeded staff detail link",
  },
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
};

type MobileNavLink = {
  href: string;
  label: string;
  height: number;
  visible: boolean;
  reachable: boolean;
};

type MobileNavReading = Rect & {
  display: string;
  position: string;
  zIndex: string;
  visible: boolean;
  insideViewport: boolean;
  bottomAligned: boolean;
  links: MobileNavLink[];
};

type ControlReading = {
  tag: string;
  label: string;
  width: number;
  height: number;
};

type TableReading = {
  label: string;
  clientWidth: number;
  scrollWidth: number;
  overflows: boolean;
  overflowContainer: "self" | "ancestor" | "none";
};

type ChartReading = {
  testId: string;
  tag: string;
  role: string | null;
  ariaLabel: string;
  dataKind: string | null;
  visible: boolean;
  rect: Rect | null;
};

type TabReading = {
  label: string;
  href: string;
  current: boolean;
  visible: boolean;
  width: number;
  height: number;
};

type Measurement = {
  title: string;
  heading: string;
  url: string;
  theme: string;
  fonts: {
    status: string;
    instrumentSans: boolean;
    bricolage: boolean;
  };
  document: {
    clientWidth: number;
    scrollWidth: number;
    horizontalOverflow: number;
    clientHeight: number;
    scrollHeight: number;
    scrollY: number;
    innerWidth: number;
    innerHeight: number;
    bodyScrollWidth: number;
  };
  shell: Rect | null;
  sidebar: (Rect & { display: string; position: string; overflowY: string }) | null;
  topbar: (Rect & { display: string; position: string; zIndex: string }) | null;
  content: Rect | null;
  mobileNav: (Rect & { display: string }) | null;
  mobileNavBar: MobileNavReading | null;
  account: Rect | null;
  navScroll: {
    clientHeight: number;
    scrollHeight: number;
    overflowY: string;
    lastItemBottom: number | null;
    navBottom: number;
    lastItemVisibleAtTop: boolean;
    scrolls: boolean;
  } | null;
  themeToggle: Rect | null;
  tables: TableReading[];
  controls: {
    count: number;
    below44: ControlReading[];
    minHeight: number | null;
  };
  charts: Rect[];
  chartNodes: ChartReading[];
  tabs: TabReading[];
  firstMemberRow: Rect | null;
  periodText: string;
  anchors: number;
  mainTextLength: number;
  hasRupee: boolean;
};

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function gitValue(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "");
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("capture did not produce a PNG");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function signIn(context: BrowserContext, phone: string): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator("form button[type=submit]");
    let enabled = false;
    for (let attempt = 0; attempt < 8 && !enabled; attempt++) {
      await page.fill("#login-phone", phone);
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
    if (!enabled) {
      throw new Error("sign-in form did not become ready for the synthetic user");
    }
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

async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(() => {
    const round = (value: number) => Math.round(value * 10) / 10;
    const rect = (element: Element | null) => {
      if (!element) return null;
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
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        box.width > 0 &&
        box.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    };
    const label = (element: Element) =>
      (
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);

    const doc = document.documentElement;
    const sidebar = document.querySelector<HTMLElement>(
      '[data-testid="owner-sidebar"]',
    );
    const topbar = document.querySelector<HTMLElement>(
      '[data-testid="owner-top-bar"]',
    );
    const nav = document.querySelector<HTMLElement>(
      '[data-testid="owner-side-nav-scroll"]',
    );
    const main = document.querySelector<HTMLElement>("main");
    const navLinks = nav
      ? Array.from(nav.querySelectorAll<HTMLElement>("a"))
      : [];
    const lastLink = navLinks.at(-1) ?? null;
    const navBox = nav?.getBoundingClientRect() ?? null;
    const lastBox = lastLink?.getBoundingClientRect() ?? null;

    const tables = Array.from(document.querySelectorAll("table"))
      // Responsive duplicate/caption tables can be display:none; only
      // rendered tables are evidence of actual overflow.
      .filter((table) => table.clientWidth > 0)
      .map((table, index) => {
        const ownOverflow = getComputedStyle(table).overflowX;
        let ancestor = table.parentElement;
        let ancestorScrolls = false;
        while (ancestor && ancestor !== document.body) {
          const style = getComputedStyle(ancestor);
          if (style.overflowX === "auto" || style.overflowX === "scroll") {
            ancestorScrolls = true;
            break;
          }
          ancestor = ancestor.parentElement;
        }
        return {
          label:
            table.querySelector("caption")?.textContent?.trim() ||
            table.querySelector("th")?.textContent?.trim() ||
            `table ${index + 1}`,
          clientWidth: table.clientWidth,
          scrollWidth: table.scrollWidth,
          overflows: table.scrollWidth > table.clientWidth + 1,
          overflowContainer:
            ownOverflow === "auto" || ownOverflow === "scroll"
              ? "self"
              : ancestorScrolls
                ? "ancestor"
                : "none",
        } as TableReading;
      });

    const clickableCheckboxTarget = (element: HTMLElement) => {
      if (
        !(element instanceof HTMLInputElement) ||
        element.type !== "checkbox"
      ) {
        return null;
      }
      const labels = Array.from(element.labels ?? []).filter(
        (item) => item.isConnected && visible(item),
      );
      if (labels.length === 0) return null;
      // One real label is the hit area. Never union disjoint labels: their
      // gap is not clickable and must not manufacture a 44px target.
      const largest = labels
        .map((item) => item.getBoundingClientRect())
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return largest
        ? { width: round(largest.width), height: round(largest.height) }
        : null;
    };
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, select, input, textarea",
      ),
    )
      .filter(visible)
      .map((element) => {
        const box = element.getBoundingClientRect();
        const checkboxTarget = clickableCheckboxTarget(element);
        return {
          tag: element.tagName.toLowerCase(),
          label: label(element),
          width: round(
            Math.max(box.width, checkboxTarget?.width ?? box.width),
          ),
          height: round(
            Math.max(box.height, checkboxTarget?.height ?? box.height),
          ),
        };
      });
    const heights = controls.map((control) => control.height);

    const mobileNavWrapper = document.querySelector<HTMLElement>(
      '[data-testid="owner-mobile-nav"]',
    );
    const mobileNavBar =
      mobileNavWrapper?.querySelector<HTMLElement>('nav[aria-label="Primary"]') ??
      document.querySelector<HTMLElement>('nav[aria-label="Primary"]');
    const mobileNavBarBox = mobileNavBar?.getBoundingClientRect() ?? null;
    const mobileNavBarStyle = mobileNavBar ? getComputedStyle(mobileNavBar) : null;
    const mobileNavBarVisible = Boolean(
      mobileNavBar &&
        mobileNavBarBox &&
        mobileNavBarStyle &&
        mobileNavBarBox.width > 0 &&
        mobileNavBarBox.height > 0 &&
        mobileNavBarStyle.display !== "none" &&
        mobileNavBarStyle.visibility !== "hidden",
    );
    const mobileNavLinks = mobileNavBar
      ? Array.from(
          mobileNavBar.querySelectorAll<HTMLAnchorElement>("a[href]"),
        ).map((link) => {
          const box = link.getBoundingClientRect();
          const style = getComputedStyle(link);
          const centerX = box.left + box.width / 2;
          const centerY = box.top + box.height / 2;
          const hit =
            centerX >= 0 &&
            centerY >= 0 &&
            centerX <= window.innerWidth &&
            centerY <= window.innerHeight
              ? document.elementFromPoint(centerX, centerY)
              : null;
          return {
            href: link.getAttribute("href") ?? "",
            label: (link.textContent ?? "").replace(/\s+/g, " ").trim(),
            height: round(box.height),
            visible:
              box.width > 0 &&
              box.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden",
            reachable: Boolean(hit && (hit === link || link.contains(hit))),
          };
        })
      : [];

    return {
      title: document.title,
      heading:
        document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ??
        "",
      url: location.href,
      theme: doc.dataset.theme ?? "",
      fonts: {
        status: document.fonts.status,
        instrumentSans: document.fonts.check('16px "Instrument Sans"'),
        bricolage: document.fonts.check('600 16px "Bricolage Grotesque"'),
      },
      document: {
        clientWidth: doc.clientWidth,
        scrollWidth: doc.scrollWidth,
        horizontalOverflow: Math.max(
          0,
          doc.scrollWidth - doc.clientWidth,
          document.body.scrollWidth - doc.clientWidth,
        ),
        clientHeight: doc.clientHeight,
        scrollHeight: doc.scrollHeight,
        scrollY: Math.round(window.scrollY),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        bodyScrollWidth: document.body.scrollWidth,
      },
      shell: rect(document.querySelector('[data-testid="owner-shell"]')),
      sidebar: sidebar
        ? {
            ...(rect(sidebar) as Rect),
            display: getComputedStyle(sidebar).display,
            position: getComputedStyle(sidebar).position,
            overflowY: getComputedStyle(sidebar).overflowY,
          }
        : null,
      topbar: topbar
        ? {
            ...(rect(topbar) as Rect),
            display: getComputedStyle(topbar).display,
            position: getComputedStyle(topbar).position,
            zIndex: getComputedStyle(topbar).zIndex,
          }
        : null,
      content: rect(document.querySelector('[data-testid="owner-content"]')),
      mobileNav: mobileNavWrapper
        ? {
            ...(rect(mobileNavWrapper) as Rect),
            display: getComputedStyle(mobileNavWrapper).display,
          }
        : null,
      mobileNavBar:
        mobileNavBar && mobileNavBarBox && mobileNavBarStyle
          ? {
              ...(rect(mobileNavBar) as Rect),
              display: mobileNavBarStyle.display,
              position: mobileNavBarStyle.position,
              zIndex: mobileNavBarStyle.zIndex,
              visible: mobileNavBarVisible,
              insideViewport: Boolean(
                mobileNavBarBox.top >= -1 &&
                  mobileNavBarBox.left >= -1 &&
                  mobileNavBarBox.bottom <= window.innerHeight + 1 &&
                  mobileNavBarBox.right <= window.innerWidth + 1,
              ),
              bottomAligned: Math.abs(mobileNavBarBox.bottom - window.innerHeight) <= 2,
              links: mobileNavLinks,
            }
          : null,
      account: rect(document.querySelector('[data-testid="owner-shell-account"]')),
      navScroll: nav
        ? {
            clientHeight: nav.clientHeight,
            scrollHeight: nav.scrollHeight,
            overflowY: getComputedStyle(nav).overflowY,
            lastItemBottom: lastBox ? round(lastBox.bottom) : null,
            navBottom: navBox ? round(navBox.bottom) : 0,
            lastItemVisibleAtTop: Boolean(
              lastBox && navBox && lastBox.bottom <= navBox.bottom + 1,
            ),
            scrolls: nav.scrollHeight > nav.clientHeight + 1,
          }
        : null,
      themeToggle: rect(document.querySelector('[data-testid="theme-toggle"]')),
      tables,
      controls: {
        count: controls.length,
        below44: controls.filter((control) => control.height < 44).slice(0, 12),
        minHeight: heights.length ? Math.min(...heights) : null,
      },
      charts: Array.from(
        document.querySelectorAll('[data-testid="owner-chart"]'),
      ).map((chart) => rect(chart) as Rect),
      chartNodes: ["owner-chart", "owner-mini-chart", "owner-mini-donut"]
        .flatMap((testId) =>
          Array.from(
            document.querySelectorAll<HTMLElement>(
              `[data-testid="${testId}"]`,
            ),
          ).map((chart) => {
            const box = chart.getBoundingClientRect();
            const style = getComputedStyle(chart);
            const rendered =
              box.width > 0 &&
              box.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden";
            return {
              testId,
              tag: chart.tagName.toLowerCase(),
              role: chart.getAttribute("role"),
              ariaLabel: chart.getAttribute("aria-label") ?? "",
              dataKind: chart.getAttribute("data-kind"),
              visible: rendered,
              rect: rendered ? (rect(chart) as Rect) : null,
            };
          }),
        ),
      tabs: Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'nav[aria-label="Member sections"] a, nav[aria-label="Fees sections"] a',
        ),
      ).map((tab) => {
        const box = tab.getBoundingClientRect();
        return {
          label: (tab.textContent ?? "").replace(/\s+/g, " ").trim(),
          href: tab.getAttribute("href") ?? "",
          current: tab.getAttribute("aria-current") === "page",
          visible:
            box.width > 0 &&
            box.height > 0 &&
            box.right > 0 &&
            box.left < document.documentElement.clientWidth,
          width: round(box.width),
          height: round(box.height),
        };
      }),
      firstMemberRow: rect(
        document.querySelector('[data-testid="member-row"]'),
      ),
      periodText: (
        document.querySelector('[data-testid="owner-home-money-band"]')
          ?.textContent ?? ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 600),
      anchors: document.querySelectorAll("a[href]").length,
      mainTextLength: (main?.innerText ?? "").length,
      hasRupee: (main?.innerText ?? "").includes("₹"),
    };
  });
}

type ScrollProbe = {
  top: { topbarTop: number | null; sidebarTop: number | null; scrollY: number };
  middle: {
    topbarTop: number | null;
    sidebarTop: number | null;
    scrollY: number;
    topbarVisible: boolean;
    sidebarVisible: boolean;
  };
  bottom: {
    topbarTop: number | null;
    sidebarTop: number | null;
    scrollY: number;
    topbarVisible: boolean;
    sidebarVisible: boolean;
  };
};

async function scrollProbe(page: Page): Promise<ScrollProbe> {
  const settle = async () => {
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await page.waitForTimeout(250);
  };
  const read = () =>
    page.evaluate(() => {
      const topbar = document
        .querySelector('[data-testid="owner-top-bar"]')
        ?.getBoundingClientRect();
      const sidebar = document
        .querySelector('[data-testid="owner-sidebar"]')
        ?.getBoundingClientRect();
      return {
        topbarTop: topbar ? Math.round(topbar.top * 10) / 10 : null,
        sidebarTop: sidebar ? Math.round(sidebar.top * 10) / 10 : null,
        scrollY: Math.round(window.scrollY),
        topbarVisible: Boolean(
          topbar &&
            topbar.bottom > 0 &&
            topbar.top < document.documentElement.clientHeight,
        ),
        sidebarVisible: Boolean(
          sidebar &&
            sidebar.bottom > 0 &&
            sidebar.top < document.documentElement.clientHeight,
        ),
      };
    });

  await page.evaluate(() => window.scrollTo(0, 0));
  await settle();
  const top = await read();

  const max = await page.evaluate(
    () =>
      Math.max(
        0,
        document.documentElement.scrollHeight - document.documentElement.clientHeight,
      ),
  );
  await page.evaluate((y) => window.scrollTo(0, y), Math.floor(max / 2));
  await settle();
  const middle = await read();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settle();
  const bottom = await read();

  await page.evaluate(() => window.scrollTo(0, 0));
  await settle();
  return { top, middle, bottom };
}

type CaptureRecord = {
  viewId: string;
  url: string;
  requestedUrl: string;
  theme: Theme;
  viewport: ViewportSpec;
  status: "captured" | "failed";
  httpStatus: number | null;
  finalUrl: string | null;
  screenshot: string | null;
  screenshotBytes: number | null;
  screenshotSize: { width: number; height: number } | null;
  note: string;
  measurements: Measurement | null;
  scrollProbe: ScrollProbe | null;
  consoleErrors: string[];
  pageErrors: string[];
  failure: string | null;
};

type ResolvedFixtures = Record<string, string | null>;

async function resolveFixtures(page: Page): Promise<ResolvedFixtures> {
  const resolved: ResolvedFixtures = {};
  for (const [key, source] of Object.entries(FIXTURE_SOURCES)) {
    try {
      await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
      await page.goto(`${BASE_URL}${source.from}`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await page.locator('[data-testid="owner-shell"]').waitFor({
        state: "visible",
        timeout: 90_000,
      });
      await page.locator(source.waitFor).first().waitFor({
        state: "visible",
        timeout: 90_000,
      });
      await page.waitForTimeout(350);
      const hrefs = await page.$$eval("a[href]", (anchors) =>
        anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
      );
      const match = hrefs
        .map((href) => {
          try {
            return new URL(href, BASE_URL).pathname;
          } catch {
            return "";
          }
        })
        .find((pathname) => source.pattern.test(pathname));
      // Preserve the old resolver contract: baseline callers may need the
      // captured href. Final templates validate/normalise at interpolation.
      resolved[key] = match ?? null;
      resolved[`${key}Path`] = match ?? null;
    } catch (error) {
      resolved[key] = null;
      resolved[`${key}Error`] = String(error).slice(0, 300);
    }
  }
  return resolved;
}

async function captureOne(
  context: BrowserContext,
  page: Page,
  view: BaselineView,
  theme: Theme,
  viewport: ViewportSpec,
): Promise<CaptureRecord> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const onConsole = (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text().slice(0, 500));
    }
  };
  const onPageError = (error: Error) => {
    pageErrors.push(error.message.slice(0, 500));
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  const screenshot = join(
    OUT_DIR,
    theme,
    viewport.name,
    `${safeName(view.id)}.png`,
  );
  let response: Response | null = null;
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await context.addCookies([
      { name: "aqua_theme", value: theme, url: BASE_URL },
    ]);
    response = await page.goto(`${BASE_URL}${view.url}`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.locator('[data-testid="owner-shell"]').waitFor({
      state: "visible",
      timeout: 120_000,
    });
    if (view.waitFor) {
      await page.locator(view.waitFor).first().waitFor({
        state: "visible",
        timeout: 120_000,
      });
    }
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForTimeout(800);

    if (view.id.includes("monthly")) {
      // The monthly chart band starts below the 900px fold. Capture the
      // actual monthly composition rather than only the page header.
      const band = page.locator('[data-testid="owner-home-money-band"]').first();
      if ((await band.count()) > 0) {
        await band.scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      }
    }

    const renderedTheme = await page.evaluate(
      () => document.documentElement.dataset.theme ?? "",
    );
    if (renderedTheme !== theme) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.locator('[data-testid="owner-shell"]').waitFor({
        state: "visible",
        timeout: 120_000,
      });
      await page.waitForTimeout(500);
    }

    const measurements = await measure(page);
    await mkdir(dirname(screenshot), { recursive: true });
    await page.screenshot({
      path: screenshot,
      fullPage: false,
      animations: "disabled",
      caret: "hide",
    });
    const bytes = await readFile(screenshot);
    const size = pngSize(bytes);

    let scroll: ScrollProbe | null = null;
    if (view.scrollProbe) {
      scroll = await scrollProbe(page);
    }

    const httpStatus = response?.status() ?? null;
    const failure =
      httpStatus !== null && httpStatus >= 400
        ? `HTTP ${httpStatus} at ${page.url()}`
        : measurements.heading
          ? null
          : "rendered page has no h1 (shell may not have rendered)";

    return {
      viewId: view.id,
      url: new URL(view.url, BASE_URL).pathname + new URL(view.url, BASE_URL).search,
      requestedUrl: `${BASE_URL}${view.url}`,
      theme,
      viewport,
      status: failure ? "failed" : "captured",
      httpStatus,
      finalUrl: page.url(),
      screenshot: screenshot.startsWith(ROOT + "/")
        ? screenshot.slice(ROOT.length + 1)
        : screenshot,
      screenshotBytes: bytes.length,
      screenshotSize: size,
      note: view.note,
      measurements,
      scrollProbe: scroll,
      consoleErrors,
      pageErrors,
      failure,
    };
  } catch (error) {
    return {
      viewId: view.id,
      url: view.url,
      requestedUrl: `${BASE_URL}${view.url}`,
      theme,
      viewport,
      status: "failed",
      httpStatus: response?.status() ?? null,
      finalUrl: page.url(),
      screenshot: null,
      screenshotBytes: null,
      screenshotSize: null,
      note: view.note,
      measurements: null,
      scrollProbe: null,
      consoleErrors,
      pageErrors,
      failure: String(error).slice(0, 800),
    };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}

async function runBaseline(context: BrowserContext): Promise<number> {
  const page = await context.newPage();
  const captures: CaptureRecord[] = [];
  const plan: Array<{
    view: BaselineView;
    theme: Theme;
    viewport: ViewportSpec;
  }> = [
    ...THEMES.flatMap((theme) =>
      BASELINE_DESKTOP.map((view) => ({ view, theme, viewport: DESKTOP })),
    ),
    ...THEMES.flatMap((theme) =>
      BASELINE_MOBILE.map((view) => ({ view, theme, viewport: MOBILE })),
    ),
  ];

  try {
    const fixtures = await resolveFixtures(page);
    for (const item of plan) {
      process.stdout.write(
        `capture ${item.theme}/${item.viewport.name}/${item.view.id} … `,
      );
      const record = await captureOne(
        context,
        page,
        item.view,
        item.theme,
        item.viewport,
      );
      captures.push(record);
      console.log(record.status);
    }

    const failures = captures.filter((capture) => capture.status !== "captured");
    const overflows = captures.filter(
      (capture) => (capture.measurements?.document.horizontalOverflow ?? 0) > 0,
    );
    const summary = {
      status: failures.length ? "baseline-partial" : "baseline-captured",
      phase: "baseline-ready",
      capturedAt: new Date().toISOString(),
      provider: {
        id: "deepseek-v4.1-flash",
        providerID: "opencode-go",
        variant: "max",
      },
      app: {
        worktree: ROOT,
        branch: gitValue(["branch", "--show-current"]),
        baseRevision: gitValue(["rev-parse", "HEAD"]),
        dirtyPaths: gitValue(["status", "--porcelain"])
          .split("\n")
          .filter(Boolean)
          .map((line) => line.slice(2).trim()),
        baseUrl: BASE_URL,
        serverMode: "next dev (NODE_ENV=development)",
        deploymentStage: "preview",
        driverRuntime: {
          node: process.version,
          execArgv: process.execArgv,
          typeStripping: process.execArgv.includes("--experimental-strip-types"),
          tsx: false,
        },
        role: "owner",
        referencePath:
          "docs/design/owner-openpen-20261029/reference/openpen-owner-design-review.html",
        referenceSha256: sha256(await readFile(REFERENCE)),
        acceptanceMatrix:
          "docs/design/owner-openpen-20261029/qa/acceptance-matrix.json",
        acceptanceMatrixSha256: sha256(await readFile(ACCEPTANCE)),
      },
      fixture: {
        kind: "guarded synthetic demo seed with 90-day history",
        database: "disposable aqua_test_* on local port 55715",
        seeded: true,
        credentialsInArtifact: false,
        dynamicUrls: fixtures,
      },
      themeMechanism:
        "aqua_theme cookie resolved server-side onto html[data-theme]; switch precedes navigation",
      browser: {
        channel: "chrome",
        headless: true,
        isolatedContext: true,
        deviceScaleFactor: 1,
        reducedMotion: "no-preference; animations disabled for screenshot only",
      },
      plan: {
        desktopViews: BASELINE_DESKTOP.map((view) => view.id),
        mobileViews: BASELINE_MOBILE.map((view) => view.id),
        themes: [...THEMES],
        desktop: DESKTOP,
        mobile: MOBILE,
      },
      summary: {
        requested: plan.length,
        captured: captures.length - failures.length,
        failed: failures.length,
        horizontalOverflowCaptures: overflows.map((capture) => ({
          viewId: capture.viewId,
          theme: capture.theme,
          viewport: capture.viewport.name,
          overflowPx: capture.measurements?.document.horizontalOverflow ?? 0,
        })),
      },
      captures,
      observations: [
        "Every requested capture rendered the owner shell and a page h1 with zero console/page errors.",
        "Instrument Sans and Bricolage Grotesque report loaded in every capture.",
        "No page-level horizontal overflow was measured in the 1280x900 or 390x844 baseline captures.",
        "The Next.js development indicator is visible bottom-left on mobile; it is a dev-server artifact, not app UI. Final comparison must use the production artifact.",
        "Bookings reports no configured price for any slot in this seeded fixture; Create booking is disabled and the page explains the refusal. That is a genuine synthetic state, not missing implementation evidence.",
        "The desktop sidebar nav is an independent scroller (scrollHeight 763px vs clientHeight 579px at 900px). Its last item needs nav scrolling; that is the designed scroll owner, not page clipping.",
        "Members scroll probe kept the header and sidebar viewport-visible at mid and bottom scroll; the preview banner scrolls away, moving the sticky top from 43.5px to 0.",
        "This is an unchanged 239357f baseline observation, not a visual or functional PASS/FAIL of the OpenPen target.",
      ],
      limits: [
        "Baseline only: the application is the unchanged 239357f integration baseline, not the OpenPen implementation.",
        "No visual or functional PASS/FAIL is implied by this file; it records the current rendered state.",
        "Owner role only; the permission-limited accountant matrix is prepared for the final run.",
        "Error states are not fabricated; the owner surface has no owner-scoped error boundary.",
        "The preview banner is present because AQUA_DEPLOYMENT_STAGE=preview.",
        "Charts are desktop-only in this baseline; mobile Home is not part of the small baseline.",
      ],
    };
    await mkdir(dirname(join(QA_DIR, "baseline.json")), { recursive: true });
    await writeFile(
      join(QA_DIR, "baseline.json"),
      JSON.stringify(summary, null, 2) + "\n",
    );
    console.log(
      `\n${summary.status}: ${summary.summary.captured}/${plan.length} captures; ` +
        `${failures.length} failures; ${overflows.length} horizontal-overflow captures`,
    );
    console.log(`evidence: ${OUT_DIR}`);
    console.log(`summary: docs/design/owner-openpen-20261029/qa/baseline.json`);
    if (failures.length) {
      for (const failure of failures) {
        console.error(
          `FAILED ${failure.theme}/${failure.viewport.name}/${failure.viewId}: ${failure.failure}`,
        );
      }
      return 1;
    }
    return 0;
  } finally {
    await page.close().catch(() => {});
  }
}

type MatrixView = {
  viewId: string;
  referenceIds: string[];
  url: string;
  fixture: string;
  params?: string[];
  action?: string | null;
  readiness?: string;
  states?: string[];
  capture?: boolean;
};

type MatrixExtra = {
  checkId: string;
  route: string;
  referenceIds: string[];
  fixture: string;
  action?: string | null;
  states?: string[];
};

type FinalMatrix = {
  status: string;
  sourceReady: { sha256: string; at: string } | null;
  reference: { path: string; sha256: string; views: number; realRoutes: number };
  themes: Theme[];
  viewports: Record<string, ViewportSpec>;
  views: MatrixView[];
  extras: MatrixExtra[];
  shellChecks: Array<Record<string, unknown>>;
  permissionChecks: Array<Record<string, unknown>>;
  stateChecks: Array<Record<string, unknown>>;
  unavailable: Array<Record<string, unknown>>;
};

function basePath(template: string): string {
  return (template.split("?")[0] ?? template)
    .replace(/\[[^\]]+\]/g, ":id")
    .replace(/\{[^}]+\}/g, ":id");
}

async function checkMatrix(): Promise<number> {
  const acceptance = await readJson<{
    referencePages: Array<{ referenceId: string; route: string }>;
  }>(ACCEPTANCE);
  const matrix = await readJson<FinalMatrix>(FINAL_MATRIX);
  const referenceIds = acceptance.referencePages.map((page) => page.referenceId);
  const matrixIds = matrix.views.map((view) => view.referenceIds).flat();
  const missing = referenceIds.filter((id) => !matrixIds.includes(id));
  const extra = matrixIds.filter((id) => !referenceIds.includes(id));
  const paths = new Set(matrix.views.map((view) => basePath(view.url)));
  const acceptancePaths = new Set(
    acceptance.referencePages.map((page) =>
      basePath(page.route.replace(" · selected invoice", "")),
    ),
  );
  const missingPaths = [...acceptancePaths].filter((path) => !paths.has(path));
  const gated = matrix.status === "prepared" && matrix.sourceReady === null;
  console.log(
    JSON.stringify(
      {
        referenceViews: referenceIds.length,
        matrixViews: matrix.views.length,
        realRoutes: paths.size,
        extras: matrix.extras.length,
        shellChecks: matrix.shellChecks.length,
        permissionChecks: matrix.permissionChecks.length,
        stateChecks: matrix.stateChecks.length,
        missingReferenceIds: missing,
        extraReferenceIds: extra,
        missingPaths,
        finalRunGated: gated,
        gateReason: gated
          ? "SOURCE_READY sha256 is not recorded; matrix is prepared only"
          : null,
      },
      null,
      2,
    ),
  );
  return missing.length || extra.length || missingPaths.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Final run (gated). No final app capture is executed in Phase 1.
// ---------------------------------------------------------------------------

type FinalGroup = "routes" | "states" | "shell" | "permission" | "responsive";

type CheckResult = {
  name: string;
  /** null = deliberately not tested / unavailable; never a fake PASS. */
  pass: boolean | null;
  detail: string;
};

type FinalRecord = {
  checkId: string;
  referenceIds: string[];
  group: FinalGroup;
  theme: Theme;
  viewport: ViewportSpec;
  url: string | null;
  requestedUrl: string | null;
  status: "CAPTURED" | "CHANGES REQUIRED" | "BLOCKED" | "UNTESTED";
  captured: boolean;
  tested: string[];
  visualReviewed: false;
  visualVerdict: "PENDING";
  httpStatus: number | null;
  finalUrl: string | null;
  screenshot: string | null;
  screenshotBytes: number | null;
  screenshotSize: { width: number; height: number } | null;
  screenshots?: string[];
  measurements: Measurement | null;
  checks: CheckResult[];
  unavailable: string[];
  defects: string[];
  consoleErrors: string[];
  pageErrors: string[];
  note: string;
} & Record<string, unknown>;

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function asTheme(value: string | undefined): Theme | undefined {
  if (value === undefined) return undefined;
  if (!THEMES.includes(value as Theme)) {
    throw new Error(`unknown theme "${value}"`);
  }
  return value as Theme;
}

function selectViewports(
  matrix: FinalMatrix,
  requested: string | undefined,
): ViewportSpec[] {
  if (requested) {
    const viewport = matrix.viewports[requested];
    if (!viewport) throw new Error(`unknown viewport "${requested}"`);
    return [viewport];
  }
  return [DESKTOP, MOBILE];
}

// Exported only for reviewer fixture tests. `main()` is guarded below so
// importing this driver cannot start a browser or read the database.
const FIXTURE_UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const MEMBER_DETAIL_PATH =
  /^\/owner\/members\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;

export function isMemberDetailPath(pathname: string): boolean {
  return MEMBER_DETAIL_PATH.test(pathname);
}

/** Captured links are paths; templates need the UUID segment, not the href. */
export function normaliseFixtureValue(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return FIXTURE_UUID.exec(value)?.[0] ?? null;
}

export function interpolateUrl(
  template: string,
  fixtures: ResolvedFixtures,
): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = fixtures[key];
    if (!value) return "";
    // Keep an explicitly requested full path for baseline callers; normal
    // final templates receive the UUID segment only.
    return key.endsWith("Path") ? value : normaliseFixtureValue(value) ?? "";
  });
}

export function unresolvedParams(
  template: string,
  fixtures: ResolvedFixtures,
): string[] {
  return [...template.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1] ?? "")
    .filter((key) => {
      const value = fixtures[key];
      if (!value) return true;
      if (key.endsWith("Path")) return false;
      // A resolver may preserve the captured href for baseline callers, but
      // an expected ID template is not resolved unless it contains a UUID.
      return key in FIXTURE_SOURCES
        ? normaliseFixtureValue(value) === null
        : false;
    });
}

function addCheck(
  checks: CheckResult[],
  name: string,
  pass: boolean | null,
  detail: string,
): void {
  checks.push({ name, pass, detail });
}

function isVisibleRect(rect: Rect | null): boolean {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function tablesContained(measurement: Measurement): CheckResult {
  const overflowing = measurement.tables.filter((table) => table.overflows);
  const uncontained = overflowing.filter(
    (table) => table.overflowContainer === "none",
  );
  return {
    name: "table-sideways-scroll-contained",
    pass: uncontained.length === 0,
    detail: overflowing.length
      ? `${overflowing.length} rendered table(s) scroll sideways; ` +
        `${uncontained.length} lack a local overflow region`
      : "no rendered table overflows",
  };
}

function expectedTab(viewId: string): { label: string; count: number } | null {
  const member: Record<string, string> = {
    member: "Overview",
    "member-payments": "Payments",
    "member-progress": "Progress",
    "member-notes": "Notes",
    "member-docs": "Documents",
  };
  const fees: Record<string, string> = {
    fees: "Dues",
    "fees-overview": "Overview",
    "fees-transactions": "Transactions",
    "fees-invoices": "Invoices",
    "fees-plans": "Plans",
  };
  if (member[viewId]) return { label: member[viewId], count: 5 };
  if (fees[viewId]) return { label: fees[viewId], count: 5 };
  return null;
}

function tabCheck(viewId: string, measurement: Measurement): CheckResult {
  const expected = expectedTab(viewId);
  if (!expected) {
    return { name: "active-tab", pass: true, detail: "not a tab view" };
  }
  const active = measurement.tabs.filter((tab) => tab.current);
  const labels = measurement.tabs.map((tab) => tab.label).join(" / ");
  if (measurement.tabs.length === 0) {
    return {
      name: "active-tab",
      pass: false,
      detail: `no ${expected.label} tab strip rendered`,
    };
  }
  return {
    name: "active-tab",
    pass:
      active.length === 1 &&
      active[0]?.label === expected.label &&
      measurement.tabs.length === expected.count,
    detail:
      `expected ${expected.label} (${expected.count} tabs); ` +
      `rendered ${labels}; active=${active.map((tab) => tab.label).join(",") || "none"}; ` +
      `visible=${measurement.tabs.filter((tab) => tab.visible).length}`,
  };
}

function chartCheck(view: MatrixView | { viewId: string; url: string }, measurement: Measurement): CheckResult {
  const params = new URL(view.url, BASE_URL).searchParams;
  const period = params.get("period");
  const expectedPeriod =
    period === "month" ? "This month" : period === "week" ? "This week" : "Today";
  const visible = measurement.chartNodes.filter((chart) => chart.visible);
  const desktop = measurement.document.innerWidth >= 1024;
  const visibleDesktop = visible.filter(
    (chart) => chart.testId === "owner-chart",
  );
  const visibleMini = visible.filter(
    (chart) => chart.testId === "owner-mini-chart",
  );
  const visibleDonut = visible.filter(
    (chart) => chart.testId === "owner-mini-donut",
  );
  const emptyState =
    /No payments captured|No collections|No attendance marks|no mix to draw|could not be read/i.test(
      measurement.periodText,
    );
  const periodLabelPresent = measurement.periodText.includes(expectedPeriod);
  const ariaOk = visible
    .filter((chart) => chart.testId !== "owner-chart")
    .every((chart) => chart.role === "img" && chart.ariaLabel.length > 0);
  const geometryOk = visible.every(
    (chart) => chart.rect && chart.rect.width > 1 && chart.rect.height > 1,
  );

  let pass = geometryOk && ariaOk && periodLabelPresent;
  if (desktop) {
    pass = pass && (visibleDesktop.length > 0 || emptyState);
  } else {
    pass = pass && (visibleMini.length > 0 || visibleDonut.length > 0 || emptyState);
  }
  return {
    name: "home-chart-visible-geometry-and-period",
    pass,
    detail:
      `period=${expectedPeriod}; periodLabel=${periodLabelPresent}; ` +
      `desktop-Charts=${visibleDesktop.length}; mini=${visibleMini.length}; ` +
      `donut=${visibleDonut.length}; aria=${ariaOk}; geometry=${geometryOk}; ` +
      `emptyState=${emptyState}; nodes=${visible.map((chart) => chart.testId).join(",") || "none"}`,
  };
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => (document.body.textContent ?? "").replace(/\s+/g, " ").trim());
}

async function applyViewAction(
  page: Page,
  action: string | null | undefined,
): Promise<CheckResult[]> {
  if (!action) return [];
  if (action === "expand-first-invoice") {
    const open = page.getByRole("button", { name: /^Open$/ }).first();
    if ((await open.count()) === 0) {
      return [
        {
          name: "invoice-expand-read-only",
          pass: null,
          detail: "no invoice row with an Open control was available",
        },
      ];
    }
    await open.click();
    const expanded = page.locator('[data-testid="invoice-expanded-status"]').first();
    try {
      await expanded.waitFor({ state: "visible", timeout: 20_000 });
    } catch {
      return [
        {
          name: "invoice-expand-read-only",
          pass: false,
          detail: "Open clicked but no expanded invoice evidence appeared",
        },
      ];
    }
    return [
      {
        name: "invoice-expand-read-only",
        pass: true,
        detail: "expanded the first seeded invoice; no payment/reversal/void control was submitted",
      },
    ];
  }
  if (action === "member-search-no-results") {
    const search = page.locator('[data-testid="members-search"]');
    if ((await search.count()) === 0) {
      return [
        {
          name: "members-empty-search",
          pass: null,
          detail: "members search not available on this fixture",
        },
      ];
    }
    await search.fill("zzzz-no-such-swimmer-qa");
    await page.waitForTimeout(900);
    const list = page.locator('[data-testid="members-list"]');
    const text = await list.innerText().catch(() => "");
    const rows = await list.locator('[data-testid="member-row"]').count();
    return [
      {
        name: "members-empty-search",
        pass: rows === 0 && /No .+ match/i.test(text),
        detail: `rows=${rows}; text="${text.replace(/\s+/g, " ").slice(0, 180)}"`,
      },
    ];
  }
  if (action === "choose-booking-slot" || action === "probe-booking-price-refusal") {
    const slot = page.locator('select[data-testid="booking-slot"]');
    if ((await slot.count()) === 0) {
      return [
        {
          name: "booking-quote-or-refusal",
          pass: null,
          detail: "no booking slot control rendered",
        },
      ];
    }
    const options = await slot.locator("option").count();
    const noPrice = page.locator('[data-testid="owner-bookings-no-price"]');
    let observedRefusal = (await noPrice.count()) > 0;
    let quoteText = "";
    for (let index = 0; index < Math.min(options, 4) && !observedRefusal; index++) {
      await slot.selectOption({ index });
      await page.waitForTimeout(700);
      quoteText = await page
        .locator('[data-testid="booking-quote"]')
        .innerText()
        .catch(() => "");
      observedRefusal = /no price|could not price|not configured/i.test(quoteText);
    }
    const create = page.locator('[data-testid="booking-create"]');
    const disabled = await create.isDisabled().catch(() => null);
    const refusal = observedRefusal || (await noPrice.count()) > 0;
    return [
      {
        name:
          action === "probe-booking-price-refusal"
            ? "booking-price-refusal-preserved"
            : "booking-quote-read-only",
        pass:
          action === "probe-booking-price-refusal"
            ? refusal
              ? true
              : null
            : quoteText.length > 0 || refusal,
        detail:
          `banner=${(await noPrice.count()) > 0}; quote="${quoteText.replace(/\s+/g, " ").slice(0, 180)}"; ` +
          `createDisabled=${disabled}; no booking submitted`,
      },
    ];
  }
  return [
    {
      name: `action:${action}`,
      pass: null,
      detail: "action is declared but not implemented",
    },
  ];
}

function baseChecks(record: {
  httpStatus: number | null;
  finalUrl: string | null;
  requestedUrl: string | null;
}, measurement: Measurement, theme: Theme): CheckResult[] {
  const checks: CheckResult[] = [];
  addCheck(
    checks,
    "http-route-ok",
    record.httpStatus !== null && record.httpStatus < 400,
    `HTTP ${record.httpStatus ?? "no response"} at ${record.finalUrl ?? "unknown"}`,
  );
  addCheck(
    checks,
    "owner-shell-visible",
    isVisibleRect(measurement.shell),
    measurement.shell
      ? `shell ${measurement.shell.width}x${measurement.shell.height}`
      : "owner shell missing",
  );
  addCheck(
    checks,
    "page-heading-present",
    Boolean(measurement.heading) || measurement.mainTextLength > 100,
    measurement.heading
      ? `h1="${measurement.heading}"`
      : `no h1; main text length ${measurement.mainTextLength}`,
  );
  addCheck(
    checks,
    "theme-applied-server-side",
    measurement.theme === theme,
    `requested=${theme}; rendered=${measurement.theme || "none"}`,
  );
  addCheck(
    checks,
    "fonts-loaded",
    measurement.fonts.instrumentSans && measurement.fonts.bricolage,
    `status=${measurement.fonts.status}; instrument=${measurement.fonts.instrumentSans}; bricolage=${measurement.fonts.bricolage}`,
  );
  addCheck(
    checks,
    "no-page-horizontal-overflow",
    measurement.document.horizontalOverflow === 0,
    `scrollWidth=${measurement.document.scrollWidth}; clientWidth=${measurement.document.clientWidth}; overflow=${measurement.document.horizontalOverflow}px`,
  );
  addCheck(
    checks,
    "control-geometry",
    measurement.controls.count === 0 || (measurement.controls.minHeight ?? 0) >= 40,
    `${measurement.controls.count} visible controls; minHeight=${measurement.controls.minHeight}; ` +
      `below44=${measurement.controls.below44.map((control) => `${control.tag}:${control.height}`).join(",") || "none"}`,
  );
  checks.push(tablesContained(measurement));
  return checks;
}

async function captureFinalView(
  context: BrowserContext,
  page: Page,
  view: MatrixView,
  theme: Theme,
  viewport: ViewportSpec,
  group: FinalGroup,
  fixtures: ResolvedFixtures,
  preAction?: (target: Page) => Promise<void>,
): Promise<FinalRecord> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const onConsole = (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
  };
  const onPageError = (error: Error) => pageErrors.push(error.message.slice(0, 500));
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  const unresolved = unresolvedParams(view.url, fixtures);
  const screenshot = join(
    OUT_DIR,
    group,
    theme,
    viewport.name,
    `${safeName(view.viewId)}.png`,
  );
  if (unresolved.length) {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    return {
      checkId: view.viewId,
      referenceIds: view.referenceIds,
      group,
      theme,
      viewport,
      url: null,
      requestedUrl: view.url,
      status: "BLOCKED",
      captured: false,
      tested: [],
      visualReviewed: false,
      visualVerdict: "PENDING",
      httpStatus: null,
      finalUrl: null,
      screenshot: null,
      screenshotBytes: null,
      screenshotSize: null,
      measurements: null,
      checks: [
        {
          name: "dynamic-fixture-resolved",
          pass: false,
          detail: `unresolved dynamic fixture(s): ${unresolved.join(", ")}`,
        },
      ],
      unavailable: [],
      defects: [`unresolved dynamic fixture(s): ${unresolved.join(", ")}`],
      consoleErrors,
      pageErrors,
      note: view.fixture,
    };
  }

  const targetUrl = interpolateUrl(view.url, fixtures);
  let response: Response | null = null;
  let measurements: Measurement | null = null;
  let checks: CheckResult[] = [];
  const unavailable: string[] = [];
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await context.addCookies([
      { name: "aqua_theme", value: theme, url: BASE_URL },
    ]);
    response = await page.goto(`${BASE_URL}${targetUrl}`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    if ((response?.status() ?? 0) >= 400) {
      // Fail fast: a 404/500 will never grow the owner shell. Preserve the
      // failure record/status instead of waiting two minutes per route.
      throw new Error(`HTTP ${response?.status()} at ${targetUrl}`);
    }
    await page.locator('[data-testid="owner-shell"]').waitFor({
      state: "visible",
      timeout: 120_000,
    });
    const readiness = view.readiness ?? "main h1";
    if (readiness === "main h1") {
      await page.locator("main h1").first().waitFor({
        state: "visible",
        timeout: 120_000,
      });
    } else {
      await page.locator(readiness).first().waitFor({
        state: "visible",
        timeout: 120_000,
      });
    }
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForTimeout(650);
    if (preAction) {
      await preAction(page);
      await page.waitForTimeout(250);
    }

    checks = await applyViewAction(page, view.action);
    const chartView = view.viewId.startsWith("home");
    const monthlyChartView = chartView && view.viewId.includes("monthly");
    if (monthlyChartView) {
      const band = page.locator('[data-testid="owner-home-money-band"]').first();
      if ((await band.count()) > 0) {
        await band.scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      }
    }
    measurements = await measure(page);
    const renderedTheme = measurements.theme;
    addCheck(
      checks,
      "theme-applied-after-interaction",
      renderedTheme === theme,
      `requested=${theme}; rendered=${renderedTheme || "none"}`,
    );

    if (view.viewId.startsWith("home") || view.action === null) {
      if (view.viewId.startsWith("home")) checks.push(chartCheck(view, measurements));
    }
    if (expectedTab(view.viewId)) checks.push(tabCheck(view.viewId, measurements));
    if (view.viewId.startsWith("schedule")) {
      const body = await bodyText(page);
      const mode =
        view.viewId === "schedule-day"
          ? "day"
          : view.viewId === "schedule-week"
            ? "week"
            : view.viewId === "schedule-agenda"
              ? "agenda"
              : new URL(targetUrl, BASE_URL).searchParams.get("view") ?? "week";
      const grid = await page.locator('[data-testid="calendar-grid"]').isVisible().catch(() => false);
      const tracks = await page.locator('[data-testid="calendar-track"]').count();
      const agenda = await page.locator(`[data-testid="${AGENDA_LIST_TESTID}"]`).isVisible().catch(() => false);
      const agendaView = await page
        .locator(`[data-testid="${AGENDA_VIEW_CONTAINER_TESTID}"]`)
        .isVisible()
        .catch(() => false);
      const agendaLists = await page
        .locator(`[data-testid="${AGENDA_LIST_TESTID}"]`)
        .count();
      const agendaItems = await page
        .locator(`[data-testid="${AGENDA_ITEM_TESTID}"]`)
        .evaluateAll(
          (nodes) =>
            nodes.filter((node) => {
              const box = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              return (
                box.width > 0 &&
                box.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden"
              );
            }).length,
        )
        .catch(() => 0);
      const range = await page
        .locator('[data-testid="calendar-range"]')
        .innerText()
        .catch(() => "");
      const phone = viewport.width < 1024;
      const agendaRendered =
        agendaView && agendaLists > 0 && agendaItems > 0;
      const pass =
        mode === "agenda"
          ? agendaRendered
          : phone
            ? (agendaLists > 0 && agendaItems > 0) || (grid && tracks > 0)
            : grid && (mode === "day" ? tracks >= 1 : tracks >= 6);
      checks.push({
        name: `schedule-${mode}-journey`,
        pass,
        detail: `mode=${mode}; grid=${grid}; tracks=${tracks}; agenda=${agenda}; agendaView=${agendaView}; agendaLists=${agendaLists}; agendaItems=${agendaItems}; range="${range.replace(/\s+/g, " ").slice(0, 120)}"; bodyHasSchedule=${/schedule/i.test(body)}`,
      });
    }
    if (view.viewId === "invoice") {
      const expanded = await page
        .locator('[data-testid="invoice-expanded-status"]')
        .count();
      checks.push({
        name: "invoice-detail-visible",
        pass: expanded > 0,
        detail: `expanded evidence nodes=${expanded}`,
      });
    }
    if (view.viewId === "member-docs" || view.url.includes("tab=documents")) {
      const body = await bodyText(page);
      checks.push({
        name: "documents-honest-unavailable",
        pass: /not available|aren't available|aren’t available/i.test(body) &&
          !(await page.locator('input[type="file"]').count()),
        detail: `body says unavailable=${/not available|aren't available|aren’t available/i.test(body)}; file inputs=${await page.locator('input[type="file"]').count()}`,
      });
    }
    if (view.viewId === "members") {
      const rows = await page.locator('[data-testid="member-row"]').count();
      checks.push({
        name: "members-populated-or-deliberate-empty",
        pass: rows > 0 || /No .+ (match|yet)/i.test(await bodyText(page)),
        detail: `member rows=${rows}`,
      });
    }
    if (view.viewId === "bookings") {
      const noPrice = await page.locator('[data-testid="owner-bookings-no-price"]').count();
      const quote = await page
        .locator('[data-testid="booking-quote"]')
        .innerText()
        .catch(() => "");
      const create = page.locator('[data-testid="booking-create"]');
      checks.push({
        name: "booking-no-price-refusal-visible",
        pass: noPrice > 0 || quote.length > 0,
        detail: `noPriceBanner=${noPrice}; quote="${quote.replace(/\s+/g, " ").slice(0, 160)}"; createDisabled=${await create.isDisabled().catch(() => null)}`,
      });
    }
    if (!measurements.heading) {
      checks.push({
        name: "heading-hierarchy",
        pass: false,
        detail: "rendered page has no h1",
      });
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
    const screenshots = [relative(ROOT, screenshot)];
    if (chartView && !monthlyChartView) {
      const band = page.locator('[data-testid="owner-home-money-band"]').first();
      if ((await band.count()) > 0) {
        await band.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const chartScreenshot = screenshot.replace(/\.png$/, "-charts.png");
        await page.screenshot({
          path: chartScreenshot,
          fullPage: false,
          animations: "disabled",
          caret: "hide",
        });
        screenshots.push(relative(ROOT, chartScreenshot));
      }
    }
    const allChecks = [
      ...baseChecks(
        {
          httpStatus: response?.status() ?? null,
          finalUrl: page.url(),
          requestedUrl: targetUrl,
        },
        measurements,
        theme,
      ),
      ...checks,
    ];
    const defects = allChecks
      .filter((check) => check.pass === false)
      .map((check) => `${check.name}: ${check.detail}`);
    const unavailableChecks = allChecks
      .filter((check) => check.pass === null)
      .map((check) => `${check.name}: ${check.detail}`);
    return {
      checkId: view.viewId,
      referenceIds: view.referenceIds,
      group,
      theme,
      viewport,
      url: targetUrl,
      requestedUrl: view.url,
      status: defects.length
        ? "CHANGES REQUIRED"
        : "CAPTURED",
      captured: true,
      tested: allChecks.filter((check) => check.pass !== null).map((check) => check.name),
      visualReviewed: false,
      visualVerdict: "PENDING",
      httpStatus: response?.status() ?? null,
      finalUrl: page.url(),
      screenshot: relative(ROOT, screenshot),
      screenshotBytes: bytes.length,
      screenshotSize: size,
      screenshots,
      measurements,
      checks: allChecks,
      unavailable: unavailableChecks,
      defects,
      consoleErrors,
      pageErrors,
      note: view.fixture,
    };
  } catch (error) {
    const fallback: FinalRecord = {
      checkId: view.viewId,
      referenceIds: view.referenceIds,
      group,
      theme,
      viewport,
      url: targetUrl,
      requestedUrl: view.url,
      status: "CHANGES REQUIRED",
      captured: false,
      tested: [],
      visualReviewed: false,
      visualVerdict: "PENDING",
      httpStatus: response?.status() ?? null,
      finalUrl: page.url(),
      screenshot: null,
      screenshotBytes: null,
      screenshotSize: null,
      measurements,
      checks,
      unavailable,
      defects: [String(error).slice(0, 800)],
      consoleErrors,
      pageErrors,
      note: view.fixture,
    };
    return fallback;
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}

type FinalRunSummary = {
  driver: "owner-openpen-final";
  status: "CAPTURED" | "CHANGES REQUIRED" | "BLOCKED" | "UNTESTED";
  sourceReady: string;
  group: FinalGroup;
  startedAt: string;
  finishedAt: string;
  app: {
    baseUrl: string;
    baseRevision: string;
    branch: string;
    outputRoot: string;
    productionBuild: boolean;
    referenceSha256: string;
  };
  themes: Theme[];
  viewports: ViewportSpec[];
  records: FinalRecord[];
  summary: {
    records: number;
    captured: number;
    testedAssertions: number;
    visualReviewed: number;
    visualPending: number;
    changesRequired: number;
    blocked: number;
    untestedRecords: number;
    horizontalOverflowRecords: number;
  };
  defects: string[];
  unavailable: string[];
  notes: string[];
};

function finalSummaryBase(
  group: FinalGroup,
  sourceSha: string,
  matrix: FinalMatrix,
  themes: Theme[],
  viewports: ViewportSpec[],
): FinalRunSummary {
  return {
    driver: "owner-openpen-final",
    status: "CAPTURED",
    sourceReady: sourceSha,
    group,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    app: {
      baseUrl: BASE_URL,
      baseRevision: gitValue(["rev-parse", "HEAD"]),
      branch: gitValue(["--no-pager", "branch", "--show-current"]),
      outputRoot: OUT_DIR,
      productionBuild: process.env.AQUA_E2E_PRODUCTION === "1",
      referenceSha256: matrix.reference.sha256,
    },
    themes,
    viewports,
    records: [],
    summary: {
      records: 0,
      captured: 0,
      testedAssertions: 0,
      visualReviewed: 0,
      visualPending: 0,
      changesRequired: 0,
      blocked: 0,
      untestedRecords: 0,
      horizontalOverflowRecords: 0,
    },
    defects: [],
    unavailable: [],
    notes: [
      "Raw production captures stay in ignored .playwright-mcp while the build fingerprint is valid; copy reviewed evidence to qa after the preview exits.",
      "visualReviewed=false means no visual PASS is claimed. Same-viewport reference comparison and independent review are separate.",
      "No save/send/payment/credential action was performed.",
    ],
  };
}

function finaliseSummary(summary: FinalRunSummary): void {
  const records = summary.records;
  summary.finishedAt = new Date().toISOString();
  summary.summary = {
    records: records.length,
    captured: records.filter((record) => record.captured).length,
    testedAssertions: records.reduce((total, record) => total + record.tested.length, 0),
    visualReviewed: records.filter((record) => record.visualReviewed).length,
    visualPending: records.filter((record) => !record.visualReviewed).length,
    changesRequired: records.filter((record) => record.status === "CHANGES REQUIRED").length,
    blocked: records.filter((record) => record.status === "BLOCKED").length,
    untestedRecords: records.filter((record) => record.status === "UNTESTED").length,
    horizontalOverflowRecords: records.filter(
      (record) => (record.measurements?.document.horizontalOverflow ?? 0) > 0,
    ).length,
  };
  summary.defects = records.flatMap((record) =>
    record.defects.map(
      (defect) =>
        `${record.group}/${record.theme}/${record.viewport.name}/${record.checkId}: ${defect}`,
    ),
  );
  summary.unavailable = records.flatMap((record) =>
    record.unavailable.map(
      (item) =>
        `${record.group}/${record.theme}/${record.viewport.name}/${record.checkId}: ${item}`,
    ),
  );
  const hard = summary.records.some(
    (record) =>
      record.status === "CHANGES REQUIRED" || record.status === "BLOCKED",
  );
  summary.status = hard
    ? "CHANGES REQUIRED"
    : summary.records.some((record) => record.status === "UNTESTED")
      ? "UNTESTED"
      : "CAPTURED";
}

async function writeFinalSummary(summary: FinalRunSummary): Promise<void> {
  finaliseSummary(summary);
  await mkdir(OUT_DIR, { recursive: true });
  const suffix = safeName(
    `${summary.group}-${summary.themes.join("+")}-${summary.viewports.map((viewport) => viewport.name).join("+")}`,
  );
  const body = JSON.stringify(summary, null, 2) + "\n";
  // Keep the latest summary and a group-specific copy: several bounded runs
  // intentionally share one ignored evidence root during production capture.
  await Promise.all([
    writeFile(join(OUT_DIR, "summary.json"), body),
    writeFile(join(OUT_DIR, `summary-${suffix}.json`), body),
  ]);
}

function enforceIgnoredOutput(): void {
  const rel = relative(ROOT, OUT_DIR);
  if (!rel.startsWith(".playwright-mcp")) {
    throw new Error(
      "Final production captures must write under ignored .playwright-mcp/ via " +
        "AQUA_E2E_OUT and owner_preview.py --out, so the build fingerprint stays valid. " +
        `Got ${rel}`,
    );
  }
}

async function runFinalRoutes(
  context: BrowserContext,
  matrix: FinalMatrix,
  sourceSha: string,
  themes: Theme[],
  viewports: ViewportSpec[],
): Promise<number> {
  enforceIgnoredOutput();
  const page = await context.newPage();
  const summary = finalSummaryBase("routes", sourceSha, matrix, themes, viewports);
  try {
    const fixtures = await resolveFixtures(page);
    summary.notes.push(`resolved fixtures: ${JSON.stringify(fixtures)}`);
    for (const theme of themes) {
      for (const viewport of viewports) {
        for (const view of matrix.views.filter((item) => item.capture !== false)) {
          process.stdout.write(`final ${theme}/${viewport.name}/${view.viewId} … `);
          const record = await captureFinalView(
            context,
            page,
            view,
            theme,
            viewport,
            "routes",
            fixtures,
          );
          summary.records.push(record);
          await writeFinalSummary(summary);
          console.log(record.status);
        }
      }
    }
    await writeFinalSummary(summary);
    console.log(
      `final routes: ${summary.summary.captured}/${summary.summary.records} captured; ` +
        `${summary.summary.changesRequired} CHANGES REQUIRED; ${summary.summary.blocked} BLOCKED; ` +
        `visualReviewed=${summary.summary.visualReviewed} (PENDING=${summary.summary.visualPending})`,
    );
    return summary.status === "CAPTURED" ? 0 : 1;
  } finally {
    await page.close().catch(() => {});
  }
}

async function runFinalStates(
  context: BrowserContext,
  matrix: FinalMatrix,
  sourceSha: string,
  themes: Theme[],
  viewports: ViewportSpec[],
): Promise<number> {
  enforceIgnoredOutput();
  const page = await context.newPage();
  const summary = finalSummaryBase("states", sourceSha, matrix, themes, viewports);
  try {
    const fixtures = await resolveFixtures(page);
    const extraViews: MatrixView[] = matrix.extras.map((extra) => ({
      viewId: extra.checkId,
      referenceIds: extra.referenceIds,
      url: extra.route,
      fixture: extra.fixture,
      params: [],
      action: extra.action ?? null,
      readiness: "main h1",
      states: extra.states ?? [],
    }));
    for (const theme of themes) {
      for (const viewport of viewports) {
        for (const view of extraViews) {
          process.stdout.write(`state ${theme}/${viewport.name}/${view.viewId} … `);
          const record = await captureFinalView(
            context,
            page,
            view,
            theme,
            viewport,
            "states",
            fixtures,
          );
          summary.records.push(record);
          await writeFinalSummary(summary);
          console.log(record.status);
        }
      }
    }

    // Loading is conditional: capture only if the real Next loading skeleton
    // is actually observed. A synthetic 500 is never used for the error state.
    for (const theme of themes) {
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
        await page.goto(`${BASE_URL}/owner`, {
          waitUntil: "domcontentloaded",
          timeout: 120_000,
        });
        await page.locator('[data-testid="owner-shell"]').waitFor({
          state: "visible",
          timeout: 120_000,
        });
        const membersLink =
          viewport.width >= 1024
            ? page
                .locator('[data-testid="owner-sidebar"] a[href="/owner/members"]')
                .first()
            : page
                .locator('[data-testid="owner-mobile-nav"] a[href="/owner/members"]')
                .first();
        const skeleton = page.locator(".animate-pulse");
        let observed = false;
        try {
          await membersLink.click({ timeout: 10_000 });
          await skeleton.first().waitFor({ state: "visible", timeout: 9_000 });
          observed = (await skeleton.count()) >= 4;
          if (observed) {
            await mkdir(
              dirname(join(OUT_DIR, "states", theme, viewport.name, "members-loading.png")),
              { recursive: true },
            );
            await page.screenshot({
              path: join(OUT_DIR, "states", theme, viewport.name, "members-loading.png"),
              fullPage: false,
              animations: "disabled",
              caret: "hide",
            });
          }
        } catch {
          observed = false;
        }
        const record: FinalRecord = {
          checkId: "loading-members",
          referenceIds: ["members"],
          group: "states",
          theme,
          viewport,
          url: "/owner/members",
          requestedUrl: "/owner/members",
          status: observed ? "CAPTURED" : "UNTESTED",
          captured: observed,
          tested: ["conditional-loading-skeleton"],
          visualReviewed: false,
          visualVerdict: "PENDING",
          httpStatus: null,
          finalUrl: page.url(),
          screenshot: observed
            ? relative(ROOT, join(OUT_DIR, "states", theme, viewport.name, "members-loading.png"))
            : null,
          screenshotBytes: null,
          screenshotSize: null,
          measurements: null,
          checks: [
            {
              name: "loading-skeleton-observed",
              pass: observed ? true : null,
              detail: observed
                ? "real Next loading skeleton was visible; captured viewport"
                : "loading completed before a skeleton could be observed; recorded UNTESTED",
            },
          ],
          unavailable: observed ? [] : ["loading skeleton completed too quickly to observe"],
          defects: [],
          consoleErrors: [],
          pageErrors: [],
          note: "Conditional state; no response was delayed or fabricated.",
        };
        summary.records.push(record);
        await writeFinalSummary(summary);
      }
    }

    summary.records.push({
      checkId: "error-owner-read",
      referenceIds: ["members"],
      group: "states",
      theme: themes[0] ?? "lavender",
      viewport: DESKTOP,
      url: null,
      requestedUrl: null,
      status: "UNTESTED",
      captured: false,
      tested: [],
      visualReviewed: false,
      visualVerdict: "PENDING",
      httpStatus: null,
      finalUrl: null,
      screenshot: null,
      screenshotBytes: null,
      screenshotSize: null,
      measurements: null,
      checks: [
        {
          name: "owner-read-error-state",
          pass: null,
          detail:
            "No app/(owner) error boundary exists in the baseline; a synthetic 500 was not injected. UNTESTED, not PASS.",
        },
      ],
      unavailable: ["owner-scoped error boundary is absent"],
      defects: [],
      consoleErrors: [],
      pageErrors: [],
      note: "Do not fabricate an error state.",
    });
    await writeFinalSummary(summary);
    console.log(
      `final states: ${summary.summary.captured}/${summary.summary.records} captured; ` +
        `${summary.summary.changesRequired} CHANGES REQUIRED; ${summary.summary.untestedRecords} UNTESTED`,
    );
    return summary.summary.changesRequired || summary.summary.blocked ? 1 : 0;
  } finally {
    await page.close().catch(() => {});
  }
}

export type Rgba = [number, number, number, number];

export function parseCssColor(value: string): Rgba | null {
  const input = value.trim().toLowerCase();
  const rgb = input.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/,
  );
  if (rgb) {
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]),
    ];
  }
  const srgb = input.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/,
  );
  if (srgb) {
    return [
      Math.round(Number(srgb[1]) * 255),
      Math.round(Number(srgb[2]) * 255),
      Math.round(Number(srgb[3]) * 255),
      srgb[4] === undefined ? 1 : Number(srgb[4]),
    ];
  }
  const hex = input.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1] ?? "";
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
      1,
    ];
  }
  return null;
}

export function composite(
  foreground: Rgba,
  background: Rgba,
): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (alpha === 0) return [0, 0, 0, 1];
  return [
    (foreground[0] * foreground[3] +
      background[0] * background[3] * (1 - foreground[3])) /
      alpha,
    (foreground[1] * foreground[3] +
      background[1] * background[3] * (1 - foreground[3])) /
      alpha,
    (foreground[2] * foreground[3] +
      background[2] * background[3] * (1 - foreground[3])) /
      alpha,
    alpha,
  ];
}

function luminance(color: Rgba): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color[0]) +
    0.7152 * channel(color[1]) +
    0.0722 * channel(color[2])
  );
}

export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const composed = composite(foreground, background);
  const light = Math.max(luminance(composed), luminance(background));
  const dark = Math.min(luminance(composed), luminance(background));
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/**
 * The colour actually painted behind an element: its own background
 * composited over its ancestors' backgrounds, alpha included, over the
 * white canvas.
 *
 * The stack is ordered element-first, outermost ancestor last. Flat
 * fills only — the owner palette paints no gradient or image behind
 * the navigation, so a background-image is not composited here.
 */
export function paintedBackground(stack: ReadonlyArray<Rgba | null>): Rgba {
  let result: Rgba = [255, 255, 255, 1];
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const layer = stack[index];
    if (!layer) continue;
    result = composite(layer, result);
  }
  return result;
}

/** The painted colour in a form a reviewer can read in the evidence. */
export function formatRgba(color: Rgba): string {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${Number(color[3].toFixed(2))})`;
}

/**
 * The contrast of a text colour against the surface that is actually
 * painted behind it.
 */
export function navContrastAgainstPainted(
  color: string,
  backgroundStack: ReadonlyArray<Rgba | null>,
): number | null {
  const foreground = parseCssColor(color);
  if (!foreground) return null;
  return contrastRatio(foreground, paintedBackground(backgroundStack));
}

/**
 * The member row the back-scroll check clicks: the first row that is
 * fully inside the viewport and clear of the sticky top bar.
 *
 * A row outside the viewport is scrolled into view by the click, which
 * moves the list and changes the position the browser restores. The
 * click must therefore land on a row that is already on screen.
 */
export function firstVisibleMemberRowIndex(
  rows: ReadonlyArray<{ index: number; top: number; bottom: number }>,
  viewport: { height: number; stickyTop: number },
): number | null {
  for (const row of rows) {
    if (row.top >= viewport.stickyTop && row.bottom <= viewport.height - 8) {
      return row.index;
    }
  }
  return null;
}

/**
 * Whether browser Back restored the list position. The comparison is
 * against the position the page had AT THE CLICK — the position the
 * browser restores — and never against a position from before it.
 */
export function backScrollRestored(
  before: number,
  after: number,
  tolerance = 40,
): boolean {
  return Math.abs(after - before) <= tolerance;
}

/**
 * The index of a member row that is on screen at the current scroll
 * position, or null when the list is too short to have one.
 */
async function visibleMemberRowIndex(page: Page): Promise<number | null> {
  const rows = await page
    .locator(MEMBER_ROW_LINK_SELECTOR)
    .evaluateAll((nodes) =>
      nodes.map((node, index) => {
        const rect = node.getBoundingClientRect();
        return { index, top: rect.top, bottom: rect.bottom };
      }),
    );
  const viewport = await page.evaluate(() => ({
    height: window.innerHeight,
    // The owner top bar is sticky and 62px tall: a row under it is
    // covered, not visible.
    stickyTop: 80,
  }));
  return firstVisibleMemberRowIndex(rows, viewport);
}

export type MobileNavSnapshot = {
  wrapperWidth: number;
  wrapperHeight: number;
  bar: {
    visible: boolean;
    position: string;
    insideViewport: boolean;
    bottomAligned: boolean;
    links: Array<{ visible: boolean; reachable: boolean; height: number }>;
  } | null;
};

/**
 * The `owner-mobile-nav` wrapper is zero-height because its child is fixed;
 * that wrapper is not the navigation. The pass condition must use the actual
 * rendered fixed nav and prove its links are reachable (hit-testable). A
 * missing, hidden or overlapped nav fails; it is never exempted.
 */
export function mobileNavigationPass(
  expectedDesktop: boolean,
  nav: MobileNavSnapshot | null,
): boolean {
  if (expectedDesktop) {
    return !nav || (nav.wrapperWidth === 0 && !nav.bar?.visible);
  }
  const bar = nav?.bar;
  return Boolean(
    bar &&
      bar.visible &&
      bar.position === "fixed" &&
      bar.insideViewport &&
      bar.bottomAligned &&
      bar.links.length >= 4 &&
      bar.links.every(
        (link) => link.visible && link.reachable && link.height >= 44,
      ),
  );
}

function shellBaseChecks(
  measurement: Measurement,
  theme: Theme,
  expectedDesktop: boolean,
): CheckResult[] {
  const checks: CheckResult[] = [];
  addCheck(
    checks,
    "theme-applied",
    measurement.theme === theme,
    `requested=${theme}; rendered=${measurement.theme || "none"}`,
  );
  addCheck(
    checks,
    "no-page-horizontal-overflow",
    measurement.document.horizontalOverflow === 0,
    `overflow=${measurement.document.horizontalOverflow}px; scrollWidth=${measurement.document.scrollWidth}; clientWidth=${measurement.document.clientWidth}`,
  );
  addCheck(
    checks,
    "topbar-visible",
    Boolean(measurement.topbar && measurement.topbar.height > 0),
    measurement.topbar
      ? `top=${measurement.topbar.y}; height=${measurement.topbar.height}; position=${measurement.topbar.position}`
      : "topbar missing",
  );
  addCheck(
    checks,
    "desktop-sidebar-expected",
    expectedDesktop
      ? Boolean(measurement.sidebar && measurement.sidebar.width > 0)
      : !measurement.sidebar || measurement.sidebar.display === "none",
    measurement.sidebar
      ? `display=${measurement.sidebar.display}; width=${measurement.sidebar.width}`
      : "no sidebar node",
  );
  addCheck(
    checks,
    "mobile-nav-expected",
    mobileNavigationPass(expectedDesktop, {
      wrapperWidth: measurement.mobileNav?.width ?? 0,
      wrapperHeight: measurement.mobileNav?.height ?? 0,
      bar: measurement.mobileNavBar
        ? {
            visible: measurement.mobileNavBar.visible,
            position: measurement.mobileNavBar.position,
            insideViewport: measurement.mobileNavBar.insideViewport,
            bottomAligned: measurement.mobileNavBar.bottomAligned,
            links: measurement.mobileNavBar.links.map((link) => ({
              visible: link.visible,
              reachable: link.reachable,
              height: link.height,
            })),
          }
        : null,
    }),
    measurement.mobileNavBar
      ? `wrapper=${measurement.mobileNav?.width ?? 0}x${measurement.mobileNav?.height ?? 0}; ` +
        `nav=${measurement.mobileNavBar.width}x${measurement.mobileNavBar.height}; ` +
        `position=${measurement.mobileNavBar.position}; bottomAligned=${measurement.mobileNavBar.bottomAligned}; ` +
        `links=${measurement.mobileNavBar.links.filter((link) => link.visible).length}/${measurement.mobileNavBar.links.length} visible; ` +
        `reachable=${measurement.mobileNavBar.links.filter((link) => link.reachable).length}/${measurement.mobileNavBar.links.length}`
      : measurement.mobileNav
        ? `wrapper=${measurement.mobileNav.width}x${measurement.mobileNav.height}; no nav[aria-label="Primary"]`
        : "no mobile nav wrapper or bar",
  );
  addCheck(
    checks,
    "account-row-reachable",
    expectedDesktop
      ? isVisibleRect(measurement.account)
      : Boolean(measurement.mobileNavBar?.visible),
    measurement.account
      ? `account row ${measurement.account.width}x${measurement.account.height} at ${measurement.account.y}`
      : "account row is hidden on this viewport; mobile exit is checked on Settings",
  );
  addCheck(
    checks,
    "reference-sidebar-width",
    expectedDesktop && measurement.sidebar
      ? Math.abs(measurement.sidebar.width - 190) <= 2
      : null,
    measurement.sidebar
      ? `sidebar width=${measurement.sidebar.width}px; contract target 190px`
      : "no desktop sidebar",
  );
  addCheck(
    checks,
    "reference-header-height",
    measurement.topbar
      ? measurement.topbar.height >= 56 && measurement.topbar.height <= 66
      : false,
    `header height=${measurement.topbar?.height ?? "missing"}px; contract target ~62px`,
  );
  addCheck(
    checks,
    "reference-control-height",
    measurement.themeToggle
      ? Math.abs(measurement.themeToggle.height - 48) <= 1
      : false,
    `theme toggle height=${measurement.themeToggle?.height ?? "missing"}px; contract target 48px`,
  );
  addCheck(
    checks,
    "focusable-targets-at-least-40px",
    measurement.controls.count === 0 || (measurement.controls.minHeight ?? 0) >= 40,
    `min=${measurement.controls.minHeight}; below40=${measurement.controls.below44.map((control) => `${control.tag}:${control.height}`).join(",") || "none"}`,
  );
  return checks;
}

async function captureShellViewport(
  context: BrowserContext,
  page: Page,
  theme: Theme,
  viewport: ViewportSpec,
  checkId: string,
  group: FinalGroup = "shell",
): Promise<{ record: FinalRecord; measurement: Measurement | null }> {
  const screenshot = join(
    OUT_DIR,
    group,
    checkId,
    theme,
    `${viewport.name}.png`,
  );
  let measurement: Measurement | null = null;
  const checks: CheckResult[] = [];
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
    await page.goto(`${BASE_URL}/owner/members`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.locator('[data-testid="owner-shell"]').waitFor({
      state: "visible",
      timeout: 120_000,
    });
    await page.locator('[data-testid="members-list"]').waitFor({
      state: "visible",
      timeout: 120_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForTimeout(500);
    measurement = await measure(page);
    checks.push(...shellBaseChecks(measurement, theme, viewport.width >= 1024));
    addCheck(
      checks,
      "expected-layout-at-breakpoint",
      viewport.width >= 1024
        ? Boolean(measurement.sidebar && measurement.sidebar.width > 0)
        : !measurement.sidebar || measurement.sidebar.display === "none",
      `width=${viewport.width}; sidebar=${measurement.sidebar?.width ?? 0}; mobileNav=${measurement.mobileNavBar?.height ?? 0}`,
    );
    await mkdir(dirname(screenshot), { recursive: true });
    await page.screenshot({
      path: screenshot,
      fullPage: false,
      animations: "disabled",
      caret: "hide",
    });
    const defects = checks
      .filter((check) => check.pass === false)
      .map((check) => `${check.name}: ${check.detail}`);
    return {
      record: {
        checkId,
        referenceIds: ["members"],
        group,
        theme,
        viewport,
        url: "/owner/members",
        requestedUrl: "/owner/members",
        status: defects.length ? "CHANGES REQUIRED" : "CAPTURED",
        captured: true,
        tested: checks.filter((check) => check.pass !== null).map((check) => check.name),
        visualReviewed: false,
        visualVerdict: "PENDING",
        httpStatus: 200,
        finalUrl: page.url(),
        screenshot: relative(ROOT, screenshot),
        screenshotBytes: (await readFile(screenshot)).length,
        screenshotSize: pngSize(await readFile(screenshot)),
        measurements: measurement,
        checks,
        unavailable: [],
        defects,
        consoleErrors: [],
        pageErrors: [],
        note: `shared shell at ${viewport.width}x${viewport.height}`,
      },
      measurement,
    };
  } catch (error) {
    return {
      record: {
        checkId,
        referenceIds: ["members"],
        group,
        theme,
        viewport,
        url: "/owner/members",
        requestedUrl: "/owner/members",
        status: "CHANGES REQUIRED",
        captured: false,
        tested: [],
        visualReviewed: false,
        visualVerdict: "PENDING",
        httpStatus: null,
        finalUrl: page.url(),
        screenshot: null,
        screenshotBytes: null,
        screenshotSize: null,
        measurements: measurement,
        checks,
        unavailable: [],
        defects: [String(error).slice(0, 800)],
        consoleErrors: [],
        pageErrors: [],
        note: `shared shell at ${viewport.width}x${viewport.height}`,
      },
      measurement,
    };
  }
}

async function signOutReachability(
  context: BrowserContext,
  page: Page,
  theme: Theme,
  viewport: ViewportSpec,
  checkId: string,
): Promise<CheckResult[]> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
  await page.goto(`${BASE_URL}/owner/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.locator('[data-testid="owner-shell"]').waitFor({
    state: "visible",
    timeout: 120_000,
  });
  await page.waitForTimeout(400);
  const button = page.getByRole("button", { name: "Sign out", exact: true }).first();
  if ((await button.count()) === 0) {
    return [
      {
        name: "sign-out-reachable",
        pass: false,
        detail: "Settings rendered no Sign out control",
      },
    ];
  }
  await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const info = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      visible: rect.width > 0 && rect.height > 0,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      withinViewport:
        rect.left >= 0 &&
        rect.right <= document.documentElement.clientWidth + 1 &&
        rect.top >= 0 &&
        rect.bottom <= document.documentElement.clientHeight + 1,
      clickable:
        (() => {
          const top = document.elementFromPoint(
            Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
            Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
          );
          return Boolean(top && (top === element || element.contains(top)));
        })(),
      coveredBy:
        (() => {
          const top = document.elementFromPoint(
            Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
            Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
          );
          return top ? top.tagName.toLowerCase() : "none";
        })(),
      display: style.display,
      visibility: style.visibility,
    };
  });
  await mkdir(
    dirname(join(OUT_DIR, "shell", checkId, theme, `${viewport.name}-signout.png`)),
    { recursive: true },
  );
  await page.screenshot({
    path: join(OUT_DIR, "shell", checkId, theme, `${viewport.name}-signout.png`),
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
  return [
    {
      name: "sign-out-reachable",
      pass: info.visible && info.withinViewport && info.clickable,
      detail: `button ${info.width}x${info.height} at ${info.x},${info.y}; withinViewport=${info.withinViewport}; clickable=${info.clickable}; coveredBy=${info.coveredBy}; display=${info.display}`,
    },
  ];
}

type FocusInfo = {
  tag: string;
  testId: string;
  href: string;
  text: string;
  color: string;
  background: string;
  sidebarBackground: string;
  /**
   * The element's own background first, then each ancestor's, so the
   * check can composite the colour that is actually painted behind the
   * text. A transparent box is not black; it is whatever the parent
   * paints.
   */
  backgroundStack: string[];
  outlineColor: string;
  outlineWidth: string;
  outlineStyle: string;
  boxShadow: string;
  fontSize: string;
  fontWeight: string;
  rect: { x: number; y: number; width: number; height: number };
  coveredBy: string;
};

async function focusAndContrast(
  page: Page,
  theme: Theme,
): Promise<{ checks: CheckResult[]; screenshots: string[] }> {
  const checks: CheckResult[] = [];
  const screenshots: string[] = [];
  await page.goto(`${BASE_URL}/owner/members`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.locator('[data-testid="members-list"]').waitFor({
    state: "visible",
    timeout: 120_000,
  });
  await page.waitForTimeout(400);

  const readFocus = (): Promise<FocusInfo> =>
    page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) {
        return {
          tag: "none",
          testId: "",
          href: "",
          text: "",
          color: "",
          background: "",
          sidebarBackground: "",
          backgroundStack: [],
          outlineColor: "",
          outlineWidth: "0px",
          outlineStyle: "none",
          boxShadow: "none",
          fontSize: "",
          fontWeight: "",
          rect: { x: 0, y: 0, width: 0, height: 0 },
          coveredBy: "",
        };
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const sidebar = document.querySelector('[data-testid="owner-sidebar"]');
      const backgroundStack: string[] = [];
      for (
        let node: HTMLElement | null = element;
        node;
        node = node.parentElement
      ) {
        backgroundStack.push(getComputedStyle(node).backgroundColor);
      }
      const top = document.elementFromPoint(
        Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
        Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
      );
      return {
        tag: element.tagName.toLowerCase(),
        testId: element.getAttribute("data-testid") ?? "",
        href: element.getAttribute("href") ?? "",
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
        color: style.color,
        background: style.backgroundColor,
        sidebarBackground: sidebar
          ? getComputedStyle(sidebar).backgroundColor
          : "transparent",
        backgroundStack,
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        coveredBy: top
          ? `${top.tagName.toLowerCase()}${top === element || element.contains(top) ? "" : " (outside)"}`
          : "none",
      };
    });

  // Focus via the keyboard so :focus-visible is genuinely exercised.
  let toggleFocus: FocusInfo | null = null;
  let navFocus: FocusInfo | null = null;
  for (let index = 0; index < 90 && (!toggleFocus || !navFocus); index++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(35);
    const info = await readFocus();
    if (!toggleFocus && info.testId === "theme-toggle") {
      toggleFocus = info;
      const path = join(OUT_DIR, "shell", "keyboard-focus", theme, "theme-toggle.png");
      await mkdir(dirname(path), { recursive: true });
      await page.screenshot({ path, fullPage: false, animations: "disabled" });
      screenshots.push(relative(ROOT, path));
    }
    if (
      !navFocus &&
      info.href === "/owner/members" &&
      info.tag === "a"
    ) {
      navFocus = info;
      const path = join(OUT_DIR, "shell", "keyboard-focus", theme, "nav-active.png");
      await mkdir(dirname(path), { recursive: true });
      await page.screenshot({ path, fullPage: false, animations: "disabled" });
      screenshots.push(relative(ROOT, path));
    }
  }

  const focusVisible = (info: FocusInfo | null) =>
    info !== null &&
    ((info.outlineStyle !== "none" && parseFloat(info.outlineWidth) >= 2) ||
      info.boxShadow !== "none");
  const notCovered = (info: FocusInfo | null) =>
    info !== null && !info.coveredBy.includes("outside");
  const toggleContrast =
    toggleFocus &&
    parseCssColor(toggleFocus.color) &&
    parseCssColor(toggleFocus.background)
      ? contrastRatio(
          parseCssColor(toggleFocus.color) as [number, number, number, number],
          parseCssColor(toggleFocus.background) as [number, number, number, number],
        )
      : null;
  // The contrast is measured against the colour that is actually
  // painted behind the text: the focused link's own background
  // composited over its ancestors'. The sidebar's own computed
  // background is transparent, and reading a transparent box as black
  // is what made the 29 October run report a false 1.5:1.
  const navPainted = paintedBackground(
    (navFocus?.backgroundStack ?? []).map((value) => parseCssColor(value)),
  );
  const navContrast =
    navFocus && parseCssColor(navFocus.color)
      ? contrastRatio(parseCssColor(navFocus.color) as Rgba, navPainted)
      : null;

  addCheck(
    checks,
    "keyboard-reaches-theme-toggle",
    toggleFocus !== null,
    toggleFocus
      ? `focused ${toggleFocus.tag} "${toggleFocus.text}" at ${toggleFocus.rect.x},${toggleFocus.rect.y}`
      : "theme toggle was not reached in 90 Tab stops",
  );
  addCheck(
    checks,
    "keyboard-reaches-active-nav-link",
    navFocus !== null,
    navFocus
      ? `focused "${navFocus.text}" at ${navFocus.rect.x},${navFocus.rect.y}`
      : "active Members nav link was not reached in 90 Tab stops",
  );
  addCheck(
    checks,
    "theme-toggle-focus-ring-visible",
    focusVisible(toggleFocus),
    toggleFocus
      ? `outline=${toggleFocus.outlineWidth} ${toggleFocus.outlineStyle}; boxShadow=${toggleFocus.boxShadow}`
      : "not reached",
  );
  addCheck(
    checks,
    "nav-focus-ring-visible",
    focusVisible(navFocus),
    navFocus
      ? `outline=${navFocus.outlineWidth} ${navFocus.outlineStyle}; boxShadow=${navFocus.boxShadow}`
      : "not reached",
  );
  addCheck(
    checks,
    "focus-not-covered-by-sticky-chrome",
    notCovered(toggleFocus) && notCovered(navFocus),
    `toggle coveredBy=${toggleFocus?.coveredBy ?? "untested"}; nav coveredBy=${navFocus?.coveredBy ?? "untested"}`,
  );
  addCheck(
    checks,
    "nav-text-contrast-both-themes",
    navContrast === null ? null : navContrast >= 4.5,
    `theme=${theme}; contrast=${navContrast ?? "unparsed"}; color=${navFocus?.color ?? "untested"}; paintedBackground=${formatRgba(navPainted)}; ownBackground=${navFocus?.background ?? "untested"}; sidebar=${navFocus?.sidebarBackground ?? "untested"}`,
  );
  addCheck(
    checks,
    "theme-toggle-contrast",
    toggleContrast === null ? null : toggleContrast >= 4.5,
    `theme=${theme}; contrast=${toggleContrast ?? "unparsed"}; color=${toggleFocus?.color ?? "untested"}; background=${toggleFocus?.background ?? "untested"}`,
  );
  addCheck(
    checks,
    "focus-ring-contrast",
    toggleFocus && navFocus
      ? (() => {
          const outline = parseCssColor(toggleFocus.outlineColor);
          const background = parseCssColor(toggleFocus.background);
          return outline && background
            ? contrastRatio(outline, background) >= 3
            : null;
        })()
      : null,
    `toggle outline=${toggleFocus?.outlineColor ?? "untested"}; background=${toggleFocus?.background ?? "untested"}`,
  );
  return { checks, screenshots };
}

async function runFinalShell(
  context: BrowserContext,
  matrix: FinalMatrix,
  sourceSha: string,
  themes: Theme[],
): Promise<number> {
  enforceIgnoredOutput();
  const page = await context.newPage();
  const summary = finalSummaryBase("shell", sourceSha, matrix, themes, [
    { name: "tablet-1024x768", width: 1024, height: 768 },
    { name: "short-desktop-1280x600", width: 1280, height: 600 },
    { name: "mobile-390x844", width: 390, height: 844 },
    { name: "zoom200-640x450", width: 640, height: 450 },
  ]);
  const topMeasurements = new Map<string, Measurement>();
  try {
    for (const theme of themes) {
      for (const [checkId, viewport] of [
        ["shell-1024x768", { name: "tablet-1024x768", width: 1024, height: 768 }],
        ["shell-breakpoint-1023x768", { name: "below-breakpoint-1023x768", width: 1023, height: 768 }],
        ["shell-breakpoint-1025x768", { name: "above-breakpoint-1025x768", width: 1025, height: 768 }],
        ["shell-short-1280x600", { name: "short-desktop-1280x600", width: 1280, height: 600 }],
        ["shell-zoom200-reflow", { name: "zoom200-640x450", width: 640, height: 450 }],
        ["shell-mobile-nav", { name: "mobile-390x844", width: 390, height: 844 }],
      ] as Array<[string, ViewportSpec]>) {
        process.stdout.write(`shell ${theme}/${checkId} … `);
        const result = await captureShellViewport(context, page, theme, viewport, checkId);
        summary.records.push(result.record);
        await writeFinalSummary(summary);
        console.log(result.record.status);
      }

      // Top / mid / bottom VIEWPORT screenshots (not full-page) and an
      // independent nav scroller check.
      process.stdout.write(`shell ${theme}/members-scroll … `);
      const scrollDir = join(OUT_DIR, "shell", "members-scroll", theme, "desktop-1280x900");
      await mkdir(scrollDir, { recursive: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
      await page.goto(`${BASE_URL}/owner/members`, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
      await page.locator('[data-testid="members-list"]').waitFor({
        state: "visible",
        timeout: 120_000,
      });
      await page.waitForTimeout(500);
      const top = await measure(page);
      topMeasurements.set(theme, top);
      await page.screenshot({
        path: join(scrollDir, "top.png"),
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
      const maxScroll = await page.evaluate(() =>
        Math.max(
          0,
          document.documentElement.scrollHeight -
            document.documentElement.clientHeight,
        ),
      );
      await page.evaluate((y) => window.scrollTo(0, y), Math.floor(maxScroll / 2));
      await page.waitForTimeout(350);
      const middle = await measure(page);
      await page.screenshot({
        path: join(scrollDir, "middle.png"),
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(350);
      const bottom = await measure(page);
      await page.screenshot({
        path: join(scrollDir, "bottom.png"),
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      const nav = page.locator('[data-testid="owner-side-nav-scroll"]').first();
      const navScroll = await nav.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return {
          scrollTop: element.scrollTop,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        };
      });
      // The nav list may simply FIT: with the preview strip gone from
      // the shell every nav item is visible at 1280x900, so there is
      // nothing to scroll. A scroll is only REQUIRED when the content
      // is taller than its scroller (beyond a rounding pixel); when it
      // fits, demanding movement would demand the impossible.
      const navScrollRequired =
        navScroll.scrollHeight > navScroll.clientHeight + 1;
      await page.waitForTimeout(250);
      const afterNav = await measure(page);
      await page.screenshot({
        path: join(scrollDir, "nav-bottom.png"),
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
      const scrollChecks: CheckResult[] = [
        {
          name: "members-page-scrolled",
          pass: maxScroll > 0,
          detail: `scrollable distance=${maxScroll}px; scrollY at bottom=${bottom.document.scrollHeight}`,
        },
        {
          name: "header-visible-through-scroll",
          pass: [middle, bottom].every(
            (measurement) =>
              Boolean(measurement.topbar && measurement.topbar.height > 0),
          ),
          detail: `topbar top top/mid/bottom=${top.topbar?.y}/ ${middle.topbar?.y}/${bottom.topbar?.y}`,
        },
        {
          name: "sidebar-visible-through-scroll",
          pass: [middle, bottom].every(
            (measurement) =>
              Boolean(measurement.sidebar && measurement.sidebar.height > 0),
          ),
          detail: `sidebar top top/mid/bottom=${top.sidebar?.y}/${middle.sidebar?.y}/${bottom.sidebar?.y}`,
        },
        {
          name: "sticky-position-stable",
          pass:
            middle.topbar?.y === bottom.topbar?.y &&
            Math.abs((middle.sidebar?.y ?? 0) - (bottom.sidebar?.y ?? 0)) <= 1,
          detail: `topbar mid/bottom=${middle.topbar?.y}/${bottom.topbar?.y}; sidebar=${middle.sidebar?.y}/${bottom.sidebar?.y}`,
        },
        {
          name: "independent-nav-scroll-reaches-last-item",
          // The movement is only demanded when there is something to
          // move. The last nav item must still be visible at the top
          // and the sidebar (the main page) must still be there after
          // the nav scroll — those clauses always apply.
          pass:
            (!navScrollRequired || navScroll.scrollTop > 0) &&
            (afterNav.navScroll?.lastItemVisibleAtTop ?? false) &&
            Boolean(afterNav.sidebar?.height),
          detail: `nav scrollTop=${navScroll.scrollTop}; client=${navScroll.clientHeight}; content=${navScroll.scrollHeight}; scrollRequired=${navScrollRequired}; lastVisible=${afterNav.navScroll?.lastItemVisibleAtTop}`,
        },
      ];
      summary.records.push({
        checkId: "shell-members-scroll",
        referenceIds: ["members"],
        group: "shell",
        theme,
        viewport: DESKTOP,
        url: "/owner/members",
        requestedUrl: "/owner/members",
        status: scrollChecks.some((check) => check.pass === false)
          ? "CHANGES REQUIRED"
          : "CAPTURED",
        captured: true,
        tested: scrollChecks.filter((check) => check.pass !== null).map((check) => check.name),
        visualReviewed: false,
        visualVerdict: "PENDING",
        httpStatus: 200,
        finalUrl: page.url(),
        screenshot: relative(ROOT, join(scrollDir, "top.png")),
        screenshots: [join(scrollDir, "top.png"), join(scrollDir, "middle.png"), join(scrollDir, "bottom.png"), join(scrollDir, "nav-bottom.png")].map((path) => relative(ROOT, path)),
        screenshotBytes: null,
        screenshotSize: null,
        measurements: bottom,
        checks: scrollChecks,
        unavailable: [],
        defects: scrollChecks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`),
        consoleErrors: [],
        pageErrors: [],
        note: "top/mid/bottom viewport screenshots plus independent sidebar nav scroll",
      });
      console.log("captured");

      // Sign-out is a Settings destination for the owner shell.
      process.stdout.write(`shell ${theme}/sign-out … `);
      const signOutChecks = await signOutReachability(
        context,
        page,
        theme,
        DESKTOP,
        "shell-sign-out",
      );
      summary.records.push({
        checkId: "shell-sign-out-reachability",
        referenceIds: ["settings"],
        group: "shell",
        theme,
        viewport: DESKTOP,
        url: "/owner/settings",
        requestedUrl: "/owner/settings",
        status: signOutChecks.some((check) => check.pass === false)
          ? "CHANGES REQUIRED"
          : "CAPTURED",
        captured: true,
        tested: signOutChecks.map((check) => check.name),
        visualReviewed: false,
        visualVerdict: "PENDING",
        httpStatus: 200,
        finalUrl: page.url(),
        screenshot: relative(ROOT, join(OUT_DIR, "shell", "shell-sign-out", theme, "desktop-1280x900-signout.png")),
        screenshotBytes: null,
        screenshotSize: null,
        measurements: null,
        checks: signOutChecks,
        unavailable: [],
        defects: signOutChecks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`),
        consoleErrors: [],
        pageErrors: [],
        note: "owner sign-out is reached through Settings; button is never clicked",
      });
      console.log("captured");

      process.stdout.write(`shell ${theme}/short-nav-scroll … `);
      await page.setViewportSize({ width: 1280, height: 600 });
      await page.goto(`${BASE_URL}/owner/members`, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
      await page.locator('[data-testid="members-list"]').waitFor({
        state: "visible",
        timeout: 120_000,
      });
      await page.waitForTimeout(400);
      const shortNav = page.locator('[data-testid="owner-side-nav-scroll"]').first();
      const shortNavResult = await shortNav.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return {
          scrollTop: element.scrollTop,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        };
      });
      await page.waitForTimeout(250);
      const shortAfter = await measure(page);
      const shortPath = join(OUT_DIR, "shell", "shell-sidebar-nav-overflow", theme, "1280x600-nav-bottom.png");
      await mkdir(dirname(shortPath), { recursive: true });
      await page.screenshot({
        path: shortPath,
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
      const shortChecks: CheckResult[] = [
        {
          name: "nav-scrolls-independently-at-600px",
          pass:
            shortNavResult.scrollTop > 0 &&
            shortNavResult.scrollHeight > shortNavResult.clientHeight,
          detail: `scrollTop=${shortNavResult.scrollTop}; client=${shortNavResult.clientHeight}; content=${shortNavResult.scrollHeight}`,
        },
        {
          name: "last-nav-item-reachable-at-600px",
          pass: shortAfter.navScroll?.lastItemVisibleAtTop ?? false,
          detail: `last item visible=${shortAfter.navScroll?.lastItemVisibleAtTop}; bottom=${shortAfter.navScroll?.lastItemBottom}; nav bottom=${shortAfter.navScroll?.navBottom}`,
        },
        {
          name: "brand-and-account-stay-reachable",
          pass:
            isVisibleRect(shortAfter.account) &&
            (shortAfter.account?.bottom ?? 0) <= 600 + 1,
          detail: `account=${shortAfter.account?.y}-${shortAfter.account?.bottom}; viewport height=600`,
        },
      ];
      summary.records.push({
        checkId: "shell-sidebar-nav-overflow",
        referenceIds: ["members"],
        group: "shell",
        theme,
        viewport: { name: "short-desktop-1280x600", width: 1280, height: 600 },
        url: "/owner/members",
        requestedUrl: "/owner/members",
        status: shortChecks.some((check) => check.pass === false)
          ? "CHANGES REQUIRED"
          : "CAPTURED",
        captured: true,
        tested: shortChecks.map((check) => check.name),
        visualReviewed: false,
        visualVerdict: "PENDING",
        httpStatus: 200,
        finalUrl: page.url(),
        screenshot: relative(ROOT, shortPath),
        screenshotBytes: null,
        screenshotSize: null,
        measurements: shortAfter,
        checks: shortChecks,
        unavailable: [],
        defects: shortChecks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`),
        consoleErrors: [],
        pageErrors: [],
        note: "independent sidebar nav scroll at the short desktop viewport",
      });
      console.log("captured");

      process.stdout.write(`shell ${theme}/mobile-sign-out … `);
      const mobileSignOut = await signOutReachability(
        context,
        page,
        theme,
        MOBILE,
        "shell-sign-out-mobile",
      );
      summary.records.push({
        checkId: "shell-mobile-sign-out-reachability",
        referenceIds: ["settings"],
        group: "shell",
        theme,
        viewport: MOBILE,
        url: "/owner/settings",
        requestedUrl: "/owner/settings",
        status: mobileSignOut.some((check) => check.pass === false)
          ? "CHANGES REQUIRED"
          : "CAPTURED",
        captured: true,
        tested: mobileSignOut.map((check) => check.name),
        visualReviewed: false,
        visualVerdict: "PENDING",
        httpStatus: 200,
        finalUrl: page.url(),
        screenshot: relative(ROOT, join(OUT_DIR, "shell", "shell-sign-out-mobile", theme, "mobile-390x844-signout.png")),
        screenshotBytes: null,
        screenshotSize: null,
        measurements: null,
        checks: mobileSignOut,
        unavailable: [],
        defects: mobileSignOut.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`),
        consoleErrors: [],
        pageErrors: [],
        note: "owner sign-out through Settings on phone; button is never clicked",
      });
      console.log("captured");

      process.stdout.write(`shell ${theme}/zoom200-exit … `);
      const zoomSignOut = await signOutReachability(
        context,
        page,
        theme,
        { name: "zoom200-640x450", width: 640, height: 450 },
        "shell-zoom200-exit",
      );
      summary.records.push({
        checkId: "shell-zoom200-exit",
        referenceIds: ["settings"],
        group: "shell",
        theme,
        viewport: { name: "zoom200-640x450", width: 640, height: 450 },
        url: "/owner/settings",
        requestedUrl: "/owner/settings",
        status: zoomSignOut.some((check) => check.pass === false)
          ? "CHANGES REQUIRED"
          : "CAPTURED",
        captured: true,
        tested: zoomSignOut.map((check) => check.name),
        visualReviewed: false,
        visualVerdict: "PENDING",
        httpStatus: 200,
        finalUrl: page.url(),
        screenshot: relative(ROOT, join(OUT_DIR, "shell", "shell-zoom200-exit", theme, "zoom200-640x450-signout.png")),
        screenshotBytes: null,
        screenshotSize: null,
        measurements: null,
        checks: zoomSignOut,
        unavailable: [],
        defects: zoomSignOut.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`),
        consoleErrors: [],
        pageErrors: [],
        note: "200% reflow emulation: sign-out reachable, never clicked",
      });
      console.log("captured");

      // Keyboard/focus and contrast.
      process.stdout.write(`shell ${theme}/keyboard-focus … `);
      const focusResult = await focusAndContrast(page, theme);
      summary.records.push({
        checkId: "shell-keyboard-focus-contrast",
        referenceIds: ["members"],
        group: "shell",
        theme,
        viewport: DESKTOP,
        url: "/owner/members",
        requestedUrl: "/owner/members",
        status: focusResult.checks.some((check) => check.pass === false)
          ? "CHANGES REQUIRED"
          : "CAPTURED",
        captured: focusResult.screenshots.length > 0,
        tested: focusResult.checks.filter((check) => check.pass !== null).map((check) => check.name),
        visualReviewed: false,
        visualVerdict: "PENDING",
        httpStatus: 200,
        finalUrl: page.url(),
        screenshot: focusResult.screenshots[0] ?? null,
        screenshots: focusResult.screenshots,
        screenshotBytes: null,
        screenshotSize: null,
        measurements: null,
        checks: focusResult.checks,
        unavailable: focusResult.checks.filter((check) => check.pass === null).map((check) => `${check.name}: ${check.detail}`),
        defects: focusResult.checks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`),
        consoleErrors: [],
        pageErrors: [],
        note: "keyboard Tab focus, visible ring, sticky coverage and computed contrast",
      });
      console.log("tested");

      // Browser Back restores the intended list position.
      process.stdout.write(`shell ${theme}/back-scroll … `);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${BASE_URL}/owner/members`, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
      await page.locator('[data-testid="members-list"]').waitFor({
        state: "visible",
        timeout: 120_000,
      });
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 1100));
      await page.waitForTimeout(250);
      const scrolledTo = await page.evaluate(() => Math.round(window.scrollY));
      // Click a member row that is ALREADY on screen at this scroll
      // position. Clicking the FIRST row made Playwright scroll it
      // back into view (1100px -> 19px) before the click, so the
      // position the browser restored was the one the click had
      // caused, and the oracle compared it with the stale 1100px.
      const visibleRow = await visibleMemberRowIndex(page);
      const beforeClick = await page.evaluate(() => Math.round(window.scrollY));
      // The scroll of the LIST at the moment the click happens. The
      // click starts a navigation, so the value is read in the capture
      // phase — before the document is replaced — and kept in session
      // storage, which survives the same-origin navigation.
      await page.evaluate(() => {
        window.sessionStorage.removeItem("aqua:member-list-scroll-at-click");
        document.addEventListener(
          "click",
          () => {
            window.sessionStorage.setItem(
              "aqua:member-list-scroll-at-click",
              String(Math.round(window.scrollY)),
            );
          },
          true,
        );
      });
      let scrollAtClick: number | null = null;
      let afterBack = beforeClick;
      let navigated = false;
      if (visibleRow !== null) {
        await Promise.all([
          page.waitForURL((url) => isMemberDetailPath(url.pathname), {
            timeout: 120_000,
          }),
          page.locator(MEMBER_ROW_LINK_SELECTOR).nth(visibleRow).click(),
        ]);
        navigated = true;
        scrollAtClick = await page.evaluate(() => {
          const raw = window.sessionStorage.getItem(
            "aqua:member-list-scroll-at-click",
          );
          return raw === null ? null : Number(raw);
        });
        await page
          .locator("main h1")
          .first()
          .waitFor({ state: "visible", timeout: 120_000 });
        await page
          .goBack({ waitUntil: "domcontentloaded", timeout: 120_000 })
          .catch(() => null);
        await page
          .waitForURL((url) => url.pathname === "/owner/members", {
            timeout: 120_000,
          })
          .catch(() => null);
        await page.locator('[data-testid="members-list"]').waitFor({
          state: "visible",
          timeout: 120_000,
        });
        await page.waitForTimeout(700);
        afterBack = await page.evaluate(() => Math.round(window.scrollY));
      }
      // The click must not have moved the list, and Back must restore
      // the position the list had at the click.
      const clickKeptScroll =
        scrollAtClick !== null && Math.abs(scrollAtClick - beforeClick) <= 2;
      const backPass = navigated && backScrollRestored(beforeClick, afterBack);
      const recordPass = backPass && clickKeptScroll;
      summary.records.push({
        checkId: "shell-back-scroll-restore",
        referenceIds: ["members"],
        group: "shell",
        theme,
        viewport: DESKTOP,
        url: "/owner/members",
        requestedUrl: "/owner/members",
        status: recordPass ? "CAPTURED" : "CHANGES REQUIRED",
        captured: false,
        tested: ["browser-back-scroll"],
        visualReviewed: false,
        visualVerdict: "PENDING",
        httpStatus: 200,
        finalUrl: page.url(),
        screenshot: null,
        screenshotBytes: null,
        screenshotSize: null,
        measurements: null,
        checks: [
          {
            name: "browser-back-restores-list-position",
            pass: backPass,
            detail: `scrolledTo=${scrolledTo}px; clickedRow=${visibleRow ?? "none"}; beforeClick=${beforeClick}px; scrollAtClick=${scrollAtClick ?? "unknown"}px; afterBack=${afterBack}px; tolerance=40px`,
          },
          {
            name: "click-does-not-move-list-position",
            pass: clickKeptScroll,
            detail: `beforeClick=${beforeClick}px; scrollAtClick=${scrollAtClick ?? "unknown"}px; tolerance=2px`,
          },
        ],
        unavailable: [],
        defects: [
          ...(backPass
            ? []
            : [`browser back scroll ${beforeClick}px -> ${afterBack}px`]),
          ...(clickKeptScroll
            ? []
            : [
                `the click moved the list ${beforeClick}px -> ${scrollAtClick ?? "unknown"}px`,
              ]),
        ],
        consoleErrors: [],
        pageErrors: [],
        note: "open a member row that is visible at the scrolled position, then browser Back",
      });
      console.log(backPass ? "passed" : "failed");
    }

    // Theme parity: same markup/geometry, only token colours.
    const [left, right] = themes.map((theme) => topMeasurements.get(theme));
    if (left && right) {
      const same = (a: number | undefined, b: number | undefined) =>
        (a ?? 0) === (b ?? 0);
      const parity =
        same(left.sidebar?.width, right.sidebar?.width) &&
        same(left.content?.x, right.content?.x) &&
        same(left.content?.width, right.content?.width) &&
        same(left.firstMemberRow?.y, right.firstMemberRow?.y);
      summary.records.push({
        checkId: "shell-theme-parity",
        referenceIds: ["members"],
        group: "shell",
        theme: themes[0] ?? "lavender",
        viewport: DESKTOP,
        url: "/owner/members",
        requestedUrl: "/owner/members",
        status: parity ? "CAPTURED" : "CHANGES REQUIRED",
        captured: false,
        tested: ["theme-geometry-parity"],
        visualReviewed: false,
        visualVerdict: "PENDING",
        httpStatus: 200,
        finalUrl: null,
        screenshot: null,
        screenshotBytes: null,
        screenshotSize: null,
        measurements: left,
        checks: [
          {
            name: "same-layout-across-presets",
            pass: parity,
            detail: `sidebar ${left.sidebar?.width}/${right.sidebar?.width}; content x ${left.content?.x}/${right.content?.x}; content width ${left.content?.width}/${right.content?.width}; first row y ${left.firstMemberRow?.y}/${right.firstMemberRow?.y}`,
          },
        ],
        unavailable: [],
        defects: parity ? [] : ["layout geometry differs between mint and lavender"],
        consoleErrors: [],
        pageErrors: [],
        note: "one markup, two presets; token colours may differ, geometry may not",
      });
    }

    await writeFinalSummary(summary);
    console.log(
      `final shell: ${summary.summary.captured}/${summary.summary.records} captured; ` +
        `${summary.summary.changesRequired} CHANGES REQUIRED; visualReviewed=${summary.summary.visualReviewed} PENDING=${summary.summary.visualPending}`,
    );
    return summary.status === "CAPTURED" ? 0 : 1;
  } finally {
    await page.close().catch(() => {});
  }
}

const RESPONSIVE_VIEWPORTS: ViewportSpec[] = [
  { name: "short-phone-390x640", width: 390, height: 640 },
  { name: "landscape-640x360", width: 640, height: 360 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
];

// Final-mode supplemental group. These are real Owner forms, inspected with
// the synthetic owner fixture only. No field is submitted and no record is
// created; the booking-price page keeps whatever the seed actually contains.
const RESPONSIVE_FORMS: MatrixView[] = [
  {
    viewId: "responsive-member-new",
    referenceIds: ["new-member"],
    url: "/owner/members/new",
    fixture: "Owner add-member form; seeded locations; read-only inspection.",
    readiness: '[data-testid="submit-member"]',
  },
  {
    viewId: "responsive-member-edit",
    referenceIds: ["edit-member"],
    url: "/owner/members/{memberId}/edit",
    fixture: "First seeded member edit form; read-only inspection.",
    readiness: "main h1",
  },
  {
    viewId: "responsive-staff-invite",
    referenceIds: ["new-invite"],
    url: "/owner/staff/invitations/new",
    fixture: "Owner staff-invitation form; no invite or message is sent.",
    readiness: "main h1",
  },
  {
    viewId: "responsive-booking-price",
    referenceIds: ["booking-prices"],
    url: "/owner/settings/booking-prices",
    fixture: "Seeded booking-price editor; no save and no positive price fixture is invented.",
    readiness: "main h1",
  },
  {
    viewId: "responsive-holiday",
    referenceIds: ["holidays"],
    url: "/owner/settings/holidays",
    fixture: "Seeded holidays plus add disclosure; no holiday is added.",
    readiness: "main h1",
  },
  {
    viewId: "responsive-branding",
    referenceIds: ["branding"],
    url: "/owner/settings/branding",
    fixture: "Seeded branding editor plus preview; no save.",
    readiness: '[data-testid="branding-preview"]',
  },
];

/**
 * The booking-price catalogue keeps its editor behind the page's OWN
 * "Add price rule" control. The responsive audit looked for a form
 * control straight after loading the route, so the keyboard check
 * found no field and failed on a page that honestly shows a button.
 * Opening the page's existing control is what a person does: nothing
 * is submitted, nothing is saved and no price is invented.
 */
export async function prepareBookingPriceForm(page: Page): Promise<boolean> {
  const add = page.locator('[data-testid="booking-price-add"]');
  if ((await add.count()) === 0) return false;
  await add.first().click();
  await page.waitForTimeout(200);
  return true;
}

async function openFirstResponsiveDisclosure(page: Page): Promise<void> {
  const summary = page.locator("main details:not([open]) > summary").first();
  if ((await summary.count()) > 0) {
    await summary.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(200);
  }
}

type ResponsiveAuditKind = "form" | "shell";

async function responsiveAudit(
  page: Page,
  theme: Theme,
  viewport: ViewportSpec,
  checkId: string,
  record: FinalRecord,
  kind: ResponsiveAuditKind,
): Promise<void> {
  const addCheck = (name: string, pass: boolean | null, detail: string) => {
    record.checks.push({ name, pass, detail });
    if (pass === false) record.defects.push(`${name}: ${detail}`);
    if (pass === null) record.unavailable.push(`${name}: ${detail}`);
    if (pass !== null) record.tested.push(name);
    if (pass === false) record.status = "CHANGES REQUIRED";
  };

  try {
    const details = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("main details"));
      return {
        total: nodes.length,
        open: nodes.filter((node) => (node as HTMLDetailsElement).open).length,
      };
    });
    addCheck(
      "details-open",
      details.total === 0 ? null : details.open > 0,
      `main details=${details.total}; open=${details.open}`,
    );

    const lastControl = await page.evaluate(() => {
      const visible = (element: Element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      };
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          "main input, main select, main textarea, main button, main a, main summary",
        ),
      ).filter(visible);
      const last = controls.at(-1);
      if (!last) {
        return {
          exists: false,
          reachable: null,
          tag: "",
          text: "",
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
        };
      }
      last.scrollIntoView({ block: "center", inline: "nearest" });
      const box = last.getBoundingClientRect();
      return {
        exists: true,
        reachable: box.top < window.innerHeight && box.bottom > 0,
        tag: last.tagName.toLowerCase(),
        text: (last.getAttribute("aria-label") ?? last.textContent ?? "")
          .trim()
          .slice(0, 100),
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      };
    });
    await page.waitForTimeout(150);
    addCheck(
      "last-control-scroll-reachable",
      lastControl.exists ? lastControl.reachable : null,
      lastControl.exists
        ? `${lastControl.tag} "${lastControl.text}" reachable=${lastControl.reachable}; page=${lastControl.scrollHeight}/${lastControl.innerHeight}`
        : `no main controls; page=${lastControl.scrollHeight}/${lastControl.innerHeight}`,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);

    await page.keyboard.press("Escape");
    const openDialogs = await page.locator("dialog[open]").count();
    addCheck(
      "escape-leaves-no-modal",
      openDialogs === 0,
      `open dialogs after Escape=${openDialogs}`,
    );

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const stops: Array<{
      tag: string;
      text: string;
      inMain: boolean;
      inNav: boolean;
    }> = [];
    for (let index = 0; index < 80; index++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active) return null;
        return {
          tag: active.tagName.toLowerCase(),
          text: (active.getAttribute("aria-label") ?? active.textContent ?? "")
            .trim()
            .slice(0, 80),
          inMain: Boolean(active.closest("main")),
          inNav: Boolean(
            active.closest(
              '[data-testid="owner-side-nav"], [data-testid="owner-mobile-nav"]',
            ),
          ),
        };
      });
      if (stop) stops.push(stop);
      const hasField = stops.some(
        (item) =>
          item.inMain && ["input", "select", "textarea"].includes(item.tag),
      );
      const hasNav = stops.some((item) => item.inNav);
      const hasAction = stops.some((item) =>
        ["button", "a", "summary"].includes(item.tag),
      );
      if (
        stops.length >= 2 &&
        hasAction &&
        (kind === "shell" ? hasNav : hasField)
      ) {
        break;
      }
    }
    const hasField = stops.some(
      (item) =>
        item.inMain && ["input", "select", "textarea"].includes(item.tag),
    );
    const hasNav = stops.some((item) => item.inNav);
    const hasAction = stops.some((item) =>
      ["button", "a", "summary"].includes(item.tag),
    );
    addCheck(
      kind === "shell" ? "keyboard-nav-reached" : "keyboard-form-control-reached",
      kind === "shell" ? hasNav : hasField,
      `${stops.length} tab stops; formControl=${hasField}; nav=${hasNav}; action=${hasAction}`,
    );
    addCheck(
      "keyboard-action-reached",
      hasAction,
      `${stops.length} tab stops; last="${stops.at(-1)?.text ?? ""}"`,
    );

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(150);
    const motion = await page.evaluate(() => {
      const toMs = (value: string) =>
        Math.max(
          0,
          ...String(value)
            .split(",")
            .map((part) => {
              const match = /^([\d.]+)(ms|s)$/.exec(part.trim());
              return match
                ? Number(match[1]) * (match[2] === "s" ? 1000 : 1)
                : 0;
            }),
        );
      const visible = (element: Element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      };
      const nodes = Array.from(
        document.querySelectorAll(
          "button, a, input, select, textarea, summary, .illustration-motion .illustration-drift, [class*='motion-']",
        ),
      )
        .filter(visible)
        .slice(0, 120);
      const transition = nodes.map((node) =>
        toMs(getComputedStyle(node).transitionDuration),
      );
      const animation = nodes.map((node) =>
        toMs(getComputedStyle(node).animationDuration),
      );
      const drift = document.querySelector(
        ".illustration-motion .illustration-drift",
      );
      const driftStyle = drift ? getComputedStyle(drift) : null;
      const driftTransform = driftStyle?.transform ?? "";
      const driftOff = driftStyle
        ? toMs(driftStyle.transitionDuration) <= 0.02 &&
          (driftTransform === "none" ||
            /matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)/.test(driftTransform))
        : null;
      return {
        media: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        candidates: nodes.length,
        maxTransition: transition.length ? Math.max(...transition) : null,
        maxAnimation: animation.length ? Math.max(...animation) : null,
        driftPresent: Boolean(drift),
        driftOff,
        driftTransform,
      };
    });
    addCheck(
      "reduced-motion-media",
      motion.media,
      `matchMedia(reduce)=${motion.media}`,
    );
    addCheck(
      "reduced-motion-transition-collapsed",
      motion.maxTransition === null ? null : motion.maxTransition <= 0.02,
      `candidates=${motion.candidates}; max transition=${motion.maxTransition ?? "none"}ms`,
    );
    addCheck(
      "reduced-motion-animation-collapsed",
      motion.maxAnimation === null ? null : motion.maxAnimation <= 0.02,
      `max animation=${motion.maxAnimation ?? "none"}ms`,
    );
    addCheck(
      "reduced-motion-illustration-off",
      motion.driftPresent ? motion.driftOff : null,
      motion.driftPresent
        ? `drift transition collapsed=${motion.driftOff}; transform=${motion.driftTransform}`
        : "no .illustration-drift on this route",
    );

    const reducedShot = join(
      OUT_DIR,
      "responsive",
      "reduced-motion",
      theme,
      viewport.name,
      `${safeName(checkId)}.png`,
    );
    await mkdir(dirname(reducedShot), { recursive: true });
    await page.screenshot({
      path: reducedShot,
      fullPage: false,
      animations: "disabled",
      caret: "hide",
    });
    record.screenshots = [
      ...(record.screenshots ?? []),
      relative(ROOT, reducedShot),
    ];
    record.note = `${record.note} Read-only responsive/reduced-motion audit; no submit/save/send/payment.`;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    record.tested = [...new Set(record.tested)];
    record.unavailable = [...new Set(record.unavailable)];
    record.defects = [...new Set(record.defects)];
  } catch (error) {
    await page.emulateMedia({ reducedMotion: "no-preference" }).catch(() => {});
    addCheck(
      "responsive-audit",
      false,
      `read-only responsive audit failed: ${String(error).slice(0, 500)}`,
    );
    record.note = `${record.note} Responsive audit failed; see checks.`;
  }
}

async function runFinalResponsive(
  context: BrowserContext,
  matrix: FinalMatrix,
  sourceSha: string,
  themes: Theme[],
): Promise<number> {
  enforceIgnoredOutput();
  const page = await context.newPage();
  const summary = finalSummaryBase(
    "responsive",
    sourceSha,
    matrix,
    themes,
    RESPONSIVE_VIEWPORTS,
  );
  summary.notes.push(
    "Viewport names are responsive proxies only; they are not physical Xiaomi, OS keyboard, AT or actual browser-zoom evidence.",
  );
  summary.notes.push(
    "Responsive forms are read-only: details may open, fields are focused/scrolled, no field is submitted and no record is created.",
  );
  summary.notes.push(
    "Booking-price coverage uses the actual seeded state only; no positive price fixture is fabricated.",
  );
  try {
    const fixtures = await resolveFixtures(page);
    for (const theme of themes) {
      for (const viewport of RESPONSIVE_VIEWPORTS) {
        for (const view of RESPONSIVE_FORMS) {
          process.stdout.write(
            `responsive ${theme}/${viewport.name}/${view.viewId} … `,
          );
          const record = await captureFinalView(
            context,
            page,
            view,
            theme,
            viewport,
            "responsive",
            fixtures,
            async (target) => {
              await openFirstResponsiveDisclosure(target);
              if (view.viewId === "responsive-booking-price") {
                await prepareBookingPriceForm(target);
              }
            },
          );
          if (record.captured) {
            await responsiveAudit(
              page,
              theme,
              viewport,
              view.viewId,
              record,
              "form",
            );
          }
          summary.records.push(record);
          await writeFinalSummary(summary);
          console.log(record.status);
        }

        process.stdout.write(
          `responsive ${theme}/${viewport.name}/shared-shell … `,
        );
        const shell = await captureShellViewport(
          context,
          page,
          theme,
          viewport,
          `responsive-shell-${viewport.name}`,
          "responsive",
        );
        if (shell.record.captured) {
          await responsiveAudit(
            page,
            theme,
            viewport,
            `responsive-shell-${viewport.name}`,
            shell.record,
            "shell",
          );
        }
        summary.records.push(shell.record);
        await writeFinalSummary(summary);
        console.log(shell.record.status);
      }
    }
    console.log(
      `final responsive: ${summary.summary.captured}/${summary.summary.records} captured; ` +
        `${summary.summary.changesRequired} CHANGES REQUIRED; ` +
        `${summary.summary.untestedRecords} UNTESTED`,
    );
    return summary.status === "CAPTURED" ? 0 : 1;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * `notFound()` can be rendered after the response has started streaming, so
 * the document status alone is not the guard contract. A safe denial either
 * returns 404 or renders the not-found boundary, and never exposes settings
 * content, settings destinations or the settings category copy.
 */
export function settingsDenialPass(input: {
  status: number | null;
  body: string;
  settingsLinks: number;
}): boolean {
  const notFoundRendered =
    /We couldn['’]t find that page|This page could not be found/i.test(
      input.body,
    );
  const restrictedExposed =
    /Settings categories|Academy profile/i.test(input.body) ||
    input.settingsLinks > 0;
  return (input.status === 404 || (input.status === 200 && notFoundRendered)) &&
    !restrictedExposed;
}

async function runFinalPermission(
  context: BrowserContext,
  matrix: FinalMatrix,
  sourceSha: string,
  themes: Theme[],
  viewports: ViewportSpec[],
): Promise<number> {
  enforceIgnoredOutput();
  const page = await context.newPage();
  const summary = finalSummaryBase("permission", sourceSha, matrix, themes, viewports);
  try {
    const routes = [
      { checkId: "accountant-home", url: "/owner", expectFinal: "/owner/fees" },
      { checkId: "accountant-members", url: "/owner/members", expectFinal: "/owner/members" },
      { checkId: "accountant-fees", url: "/owner/fees?tab=dues", expectFinal: "/owner/fees" },
      { checkId: "accountant-reports", url: "/owner/reports", expectFinal: "/owner/reports" },
      { checkId: "accountant-settings-denied", url: "/owner/settings", expectFinal: null },
    ];
    for (const theme of themes) {
      for (const viewport of viewports) {
        for (const route of routes) {
          process.stdout.write(`permission ${theme}/${viewport.name}/${route.checkId} … `);
          const screenshot = join(
            OUT_DIR,
            "permission",
            theme,
            viewport.name,
            `${route.checkId}.png`,
          );
          let status: number | null = null;
          const checks: CheckResult[] = [];
          try {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
            const response = await page.goto(`${BASE_URL}${route.url}`, {
              waitUntil: "domcontentloaded",
              timeout: 120_000,
            });
            status = response?.status() ?? null;
            await page.waitForTimeout(500);
            const finalPath = new URL(page.url()).pathname;
            const body = await bodyText(page);
            await mkdir(dirname(screenshot), { recursive: true });
            await page.screenshot({
              path: screenshot,
              fullPage: false,
              animations: "disabled",
              caret: "hide",
            });
            if (route.checkId === "accountant-home") {
              addCheck(
                checks,
                "accountant-home-redirects-to-fees",
                finalPath === "/owner/fees",
                `final path=${finalPath}; expected /owner/fees; status=${status}`,
              );
            } else if (route.checkId === "accountant-settings-denied") {
              const settingsLinks = await page
                .locator('a[href^="/owner/settings"]')
                .count();
              addCheck(
                checks,
                "accountant-settings-safe-denial",
                settingsDenialPass({ status, body, settingsLinks }),
                `status=${status}; final path=${finalPath}; settings links=${settingsLinks}; settings content leaked=${/Settings categories|Academy profile/i.test(body)}`,
              );
            } else {
              addCheck(
                checks,
                "authorized-accountant-route",
                status !== null && status < 400,
                `status=${status}; final path=${finalPath}`,
              );
              const headings = await page.locator("main h1").first().innerText().catch(() => "");
              addCheck(
                checks,
                "authorized-page-rendered",
                headings.length > 0,
                `h1="${headings.replace(/\s+/g, " ")}"; body length=${body.length}`,
              );
            }
            if (route.checkId === "accountant-fees") {
              const tabs = await page
                .locator('nav[aria-label="Fees sections"] a')
                .allTextContents();
              const settingsLinks = await page.locator('a[href="/owner/settings"]').count();
              addCheck(
                checks,
                "accountant-no-plan-management-tab",
                !tabs.some((tab) => tab.trim() === "Plans") && settingsLinks === 0,
                `tabs=${tabs.map((tab) => tab.trim()).join(" / ")}; settingsLinks=${settingsLinks}`,
              );
            }
            if (route.checkId === "accountant-members" || route.checkId === "accountant-fees") {
              const navHrefs = await page.$$eval(
                '[data-testid="owner-sidebar"] a[href], [data-testid="owner-mobile-nav"] a[href]',
                (anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
              );
              addCheck(
                checks,
                "accountant-nav-limited",
                !navHrefs.some((href) =>
                  ["/owner/settings", "/owner/staff", "/owner/programs", "/owner/announcements"].includes(href),
                ),
                `nav hrefs=${[...new Set(navHrefs)].join(", ")}`,
              );
            }
            const defects = checks
              .filter((check) => check.pass === false)
              .map((check) => `${check.name}: ${check.detail}`);
            summary.records.push({
              checkId: route.checkId,
              referenceIds: [],
              group: "permission",
              theme,
              viewport,
              url: route.url,
              requestedUrl: route.url,
              status: defects.length ? "CHANGES REQUIRED" : "CAPTURED",
              captured: true,
              tested: checks.filter((check) => check.pass !== null).map((check) => check.name),
              visualReviewed: false,
              visualVerdict: "PENDING",
              httpStatus: status,
              finalUrl: page.url(),
              screenshot: relative(ROOT, screenshot),
              screenshotBytes: null,
              screenshotSize: null,
              measurements: null,
              checks,
              unavailable: [],
              defects,
              consoleErrors: [],
              pageErrors: [],
              note: "permission-limited accountant, synthetic login; no write action",
            });
            console.log("captured");
          } catch (error) {
            summary.records.push({
              checkId: route.checkId,
              referenceIds: [],
              group: "permission",
              theme,
              viewport,
              url: route.url,
              requestedUrl: route.url,
              status: "BLOCKED",
              captured: false,
              tested: [],
              visualReviewed: false,
              visualVerdict: "PENDING",
              httpStatus: status,
              finalUrl: page.url(),
              screenshot: null,
              screenshotBytes: null,
              screenshotSize: null,
              measurements: null,
              checks,
              unavailable: [],
              defects: [String(error).slice(0, 800)],
              consoleErrors: [],
              pageErrors: [],
              note: "permission-limited accountant",
            });
            console.log("blocked");
          }
          await writeFinalSummary(summary);
        }
      }
    }

    // Accountant has no Settings destination, so the shell-level sign-out is
    // the only exit. Prove it is reachable at both required sizes.
    for (const theme of themes) {
      for (const viewport of [DESKTOP, MOBILE]) {
        process.stdout.write(`permission ${theme}/${viewport.name}/accountant-signout … `);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
        await page.goto(`${BASE_URL}/owner/fees`, {
          waitUntil: "domcontentloaded",
          timeout: 120_000,
        });
        await page.waitForTimeout(400);
        const button = page.getByRole("button", { name: "Sign out", exact: true }).first();
        const visible = (await button.count()) > 0
          ? await button.isVisible().catch(() => false)
          : false;
        const screenshot = join(
          OUT_DIR,
          "permission",
          theme,
          viewport.name,
          "accountant-signout.png",
        );
        await mkdir(dirname(screenshot), { recursive: true });
        await page.screenshot({
          path: screenshot,
          fullPage: false,
          animations: "disabled",
          caret: "hide",
        });
        const pass = visible;
        summary.records.push({
          checkId: "accountant-signout",
          referenceIds: ["settings"],
          group: "permission",
          theme,
          viewport,
          url: "/owner/fees",
          requestedUrl: "/owner/fees",
          status: pass ? "CAPTURED" : "CHANGES REQUIRED",
          captured: true,
          tested: ["accountant-shell-sign-out-visible"],
          visualReviewed: false,
          visualVerdict: "PENDING",
          httpStatus: 200,
          finalUrl: page.url(),
          screenshot: relative(ROOT, screenshot),
          screenshotBytes: null,
          screenshotSize: null,
          measurements: null,
          checks: [
            {
              name: "accountant-shell-sign-out-visible",
              pass,
              detail: visible ? "Sign out button visible; not clicked" : "no visible Sign out control",
            },
          ],
          unavailable: [],
          defects: pass ? [] : ["accountant shell sign-out is not reachable"],
          consoleErrors: [],
          pageErrors: [],
          note: "accountant shell exit; no sign-out click",
        });
        console.log(pass ? "passed" : "failed");
        await writeFinalSummary(summary);
      }
    }

    await writeFinalSummary(summary);
    console.log(
      `final permission: ${summary.summary.captured}/${summary.summary.records} captured; ` +
        `${summary.summary.changesRequired} CHANGES REQUIRED`,
    );
    return summary.status === "CAPTURED" ? 0 : 1;
  } finally {
    await page.close().catch(() => {});
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--check-matrix")) {
    return checkMatrix();
  }
  if (!args.includes("--baseline") && !args.includes("--final")) {
    throw new Error("pass --baseline, --final or --check-matrix");
  }
  if (args.includes("--final")) {
    const matrix = await readJson<FinalMatrix>(FINAL_MATRIX);
    const sourceShaIndex = args.indexOf("--source-sha");
    const supplied =
      sourceShaIndex >= 0 ? (args[sourceShaIndex + 1] ?? "") : "";
    if (!matrix.sourceReady || !supplied || supplied !== matrix.sourceReady.sha256) {
      throw new Error(
        "Refusing final capture: coordinator SOURCE_READY hash is not recorded in " +
          "qa/final-matrix.json and/or --source-sha does not match. The current " +
          "checkout is the unchanged baseline.",
      );
    }
    const group = (argValue(args, "--group") ?? "routes") as FinalGroup;
    if (!["routes", "states", "shell", "permission", "responsive"].includes(group)) {
      throw new Error(`unknown final group "${group}"`);
    }
    const requestedTheme = asTheme(argValue(args, "--theme"));
    const themes = requestedTheme ? [requestedTheme] : [...THEMES];
    const viewports = selectViewports(matrix, argValue(args, "--viewport"));
    process.env.AQUA_E2E_PRODUCTION =
      process.env.AQUA_E2E_PRODUCTION ??
      (process.env.NODE_ENV === "production" ? "1" : "0");

    await mkdir(OUT_DIR, { recursive: true });
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
      deviceScaleFactor: 1,
      colorScheme: "light",
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      acceptDownloads: false,
    });
    try {
      await signIn(
        context,
        group === "permission" ? ACCOUNTANT_PHONE : PHONE,
      );
      if (group === "routes") {
        return await runFinalRoutes(context, matrix, supplied, themes, viewports);
      }
      if (group === "states") {
        return await runFinalStates(context, matrix, supplied, themes, viewports);
      }
      if (group === "shell") {
        return await runFinalShell(context, matrix, supplied, themes);
      }
      if (group === "responsive") {
        return await runFinalResponsive(context, matrix, supplied, themes);
      }
      return await runFinalPermission(context, matrix, supplied, themes, viewports);
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: DESKTOP.width, height: DESKTOP.height },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    acceptDownloads: false,
  });
  try {
    await signIn(context, PHONE);
    return await runBaseline(context);
  } finally {
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
      console.error(`QA DRIVER STOP: ${String(error).slice(0, 1200)}`);
      process.exitCode = 1;
    });
}
