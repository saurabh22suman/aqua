// Owner redesign · People lane (C2) — browser evidence.
//
// This driver is the browser half of the lane's evidence run. It is
// started by `.opencode/scripts/preview_job.py`, which owns the dev
// server, the readiness wait and the cleanup of both.
//
// What it proves (rendered geometry, not class strings):
//
//   1. The people list toolbar puts the search entry and the status
//      picker on ONE baseline — their control bottoms agree within a
//      pixel.
//   2. No page gains a horizontal scrollbar at 390×844 or 1280×900.
//   3. A directory row reads identity → status → metadata on a phone:
//      the lifecycle badge sits above the metadata line.
//   4. The owner enquiry board leads with oversight and the routine
//      capture still records an enquiry.
//
// Usage (inside the compound job):
//   python3 .opencode/scripts/lane_job.py exec python3 .opencode/scripts/preview_job.py \
//     --port 3182 --check-timeout 600 -- pnpm exec tsx e2e/owner-redesign-c2-people-layout.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const BASE = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3182";
const OUT = process.env.AQUA_E2E_OUT ?? "/tmp/opencode/people-browser";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const RECEPTION_PHONE = process.env.AQUA_E2E_RECEPTION_PHONE ?? "+919000000005";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";

const ROUTES = [
  { path: "/owner/members", name: "members" },
  { path: "/owner/members/new", name: "members-new" },
  { path: "/owner/members/import", name: "members-import" },
  { path: "/owner/fees", name: "fees" },
  { path: "/owner/fees?tab=dues", name: "fees-dues" },
  { path: "/owner/fees?tab=invoices", name: "fees-invoices" },
  { path: "/owner/fees?tab=transactions", name: "fees-transactions" },
  { path: "/owner/fees?tab=plans", name: "fees-plans" },
  { path: "/owner/enquiries", name: "enquiries" },
  { path: "/owner/staff", name: "staff" },
  { path: "/owner/staff/new", name: "staff-new" },
  { path: "/owner/staff/invitations", name: "staff-invitations" },
  { path: "/owner/staff/invitations/new", name: "staff-invitations-new" },
  { path: "/owner/staff/leave", name: "staff-leave" },
  { path: "/owner/staff/roster", name: "staff-roster" },
  { path: "/owner/staff/check-in-qr", name: "staff-check-in-qr" },
  { path: "/owner/announcements", name: "announcements" },
];

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
];

type Box = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

type Finding = {
  check: string;
  route: string;
  viewport: string;
  ok: boolean;
  detail: string;
};

const findings: Finding[] = [];
const pending: Finding[] = [];

function record(
  check: string,
  route: string,
  viewport: string,
  ok: boolean,
  detail: string,
) {
  const finding = { check, route, viewport, ok, detail };
  findings.push(finding);
  // Streamed as it happens: a mid-run setup failure must not lose the
  // evidence that was already measured.
  console.log(
    `${ok ? "PASS" : "FAIL"} ${check} · ${route} · ${viewport} — ${detail}`,
  );
}

/**
 * A measurement the contract requires but the shared System snapshot
 * has not delivered yet: the standard controls must compute to a 48px
 * height, a 10px radius and 16px text. The lane consumes the shared
 * primitives rather than restating their metrics, so these values
 * arrive with the System snapshot. They are reported as PENDING, never
 * counted as a pass.
 */
function recordPending(
  check: string,
  route: string,
  viewport: string,
  ok: boolean,
  detail: string,
) {
  pending.push({ check, route, viewport, ok, detail });
}

/**
 * Sign in with the demo owner credentials.
 *
 * The login form is a React client component: filling it before the
 * hydration lands writes the DOM value without the state, and the
 * submit button stays closed. Wait for the app to be live, fill, blur
 * the PIN so the form's own validation runs, and only click once the
 * button is genuinely enabled. The offline safety rules are not
 * bypassed and nothing is force-enabled.
 */
async function signIn(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const submit = page.locator('form button[type="submit"]');
    let enabled = false;
    for (let attempt = 0; attempt < 6 && !enabled; attempt++) {
      await page.fill("#login-phone", PHONE);
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

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  // The owner surfaces are client islands inside server-rendered pages;
  // give React a beat to hydrate before any geometry is read.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

async function checkMembers(page: Page, viewport: string) {
  // The measurement runs as a STRING expression: tsx compiles the file
  // with esbuild's keepNames, which rewrites a named inner function
  // inside page.evaluate into a `__name(...)` call that does not exist
  // in the page. A string is evaluated by the browser as written.
  const geometry = (await page.evaluate(`(() => {
    var box = function (el) {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
      };
    };
    var rows = Array.prototype.slice.call(
      document.querySelectorAll('[data-testid="member-row"]'),
    );
    var longRow = rows.filter(function (element) {
      var name = element.querySelector('[data-testid="member-row-name"]');
      return (name && name.textContent ? name.textContent.length : 0) > 28;
    })[0];
    var longNameEl = longRow
      ? longRow.querySelector('[data-testid="member-row-name"]')
      : null;
    var longBadgeEl = longRow
      ? longRow.querySelector('[data-testid="member-row-status"]')
      : null;
    var row = rows[0];
    return {
      toolbar: box(document.querySelector('[data-testid="list-toolbar"]')),
      search: box(document.querySelector('[data-testid="members-search"]')),
      status: box(document.querySelector('[data-testid="members-status-filter"]')),
      name: box(row ? row.querySelector('[data-testid="member-row-name"]') : null),
      badge: box(row ? row.querySelector('[data-testid="member-row-status"]') : null),
      meta: box(row ? row.querySelector('[data-testid="member-row-meta"]') : null),
      phone: box(row ? row.querySelector('[data-testid="member-row-phone"]') : null),
      longName: box(longNameEl),
      longBadge: box(longBadgeEl),
      longNameClipped: longNameEl
        ? longNameEl.scrollWidth > longNameEl.clientWidth + 1
        : null,
      longNameHeight: longNameEl ? longNameEl.getBoundingClientRect().height : null,
      longNameText: longNameEl ? longNameEl.textContent : null,
    };
  })()`)) as {
    toolbar: Box | null;
    search: Box | null;
    status: Box | null;
    name: Box | null;
    badge: Box | null;
    meta: Box | null;
    phone: Box | null;
    longName: Box | null;
    longBadge: Box | null;
    longNameClipped: boolean | null;
    longNameHeight: number | null;
    longNameText: string | null;
  };

  const {
    search,
    status,
    name,
    badge,
    meta,
    phone,
    longName,
    longBadge,
    longNameClipped,
    longNameHeight,
    longNameText,
  } = geometry;

  record(
    "toolbar exists",
    "/owner/members",
    viewport,
    Boolean(search && status),
    `search=${JSON.stringify(search)} status=${JSON.stringify(status)}`,
  );

  if (search && status) {
    const delta = Math.abs(search.bottom - status.bottom);
    const sameRow = Math.abs(search.top - status.top) <= 2;
    if (sameRow) {
      // Row layout (desktop): the two controls share one baseline and
      // the picker stays bounded while the search entry takes the room.
      record(
        "toolbar controls share one bottom baseline",
        "/owner/members",
        viewport,
        delta <= 1.5,
        `bottom delta ${delta.toFixed(2)}px (search ${search.bottom.toFixed(1)}, status ${status.bottom.toFixed(1)})`,
      );
      record(
        "status picker is bounded and the search entry is the flexible one",
        "/owner/members",
        viewport,
        status.width <= 240 && search.width >= status.width,
        `search width ${search.width.toFixed(1)}px, status width ${status.width.toFixed(1)}px`,
      );
    } else {
      // Stacked layout (phone): the approved toolbar stacks on a phone.
      // The controls must be in vertical order, the same full width, and
      // the FIELDS must keep the toolbar's gap — and they must not
      // overflow.
      const gap = status.top - search.bottom;
      record(
        "stacked toolbar keeps vertical order",
        "/owner/members",
        viewport,
        status.top > search.bottom,
        `search bottom ${search.bottom.toFixed(1)}, status top ${status.top.toFixed(1)}`,
      );
      record(
        "stacked toolbar controls are the same full width",
        "/owner/members",
        viewport,
        Math.abs(search.width - status.width) <= 1 &&
          Math.abs(search.left - status.left) <= 1 &&
          Math.abs(status.right - search.right) <= 1,
        `search ${search.left.toFixed(1)}–${search.right.toFixed(1)}px, status ${status.left.toFixed(1)}–${status.right.toFixed(1)}px`,
      );
      const fieldGap = await page.evaluate(`(() => {
        var fields = document.querySelectorAll('[data-testid="toolbar-field"]');
        if (fields.length < 2) return null;
        var a = fields[0].getBoundingClientRect();
        var b = fields[1].getBoundingClientRect();
        return { gap: Math.round((b.top - a.bottom) * 100) / 100 };
      })()`) as { gap: number } | null;
      record(
        "stacked toolbar keeps the field gap",
        "/owner/members",
        viewport,
        fieldGap !== null && fieldGap.gap >= 10 && fieldGap.gap <= 16,
        `field gap ${fieldGap ? fieldGap.gap.toFixed(1) : "n/a"}px (control-to-control ${gap.toFixed(1)}px, which also spans the next label)`,
      );
    }
  }

  const metrics = await page.evaluate(`(() => {
    var read = function (selector) {
      var el = document.querySelector(selector);
      if (!el) return null;
      var style = window.getComputedStyle(el);
      var r = el.getBoundingClientRect();
      return {
        height: Math.round(r.height * 100) / 100,
        radius: style.borderTopLeftRadius,
        fontSize: style.fontSize,
      };
    };
    return {
      search: read('[data-testid="members-search"]'),
      status: read('[data-testid="members-status-filter"]'),
    };
  })()`) as {
    search: { height: number; radius: string; fontSize: string } | null;
    status: { height: number; radius: string; fontSize: string } | null;
  };
  for (const [label, value] of Object.entries(metrics)) {
    if (!value) continue;
    const ok =
      Math.round(value.height) === 48 &&
      value.radius === "10px" &&
      value.fontSize === "16px";
    recordPending(
      `shared control metrics · ${label} (48px / 10px / 16px)`,
      "/owner/members",
      viewport,
      ok,
      `height ${value.height}px, radius ${value.radius}, font-size ${value.fontSize}`,
    );
  }

  if (name && badge && meta) {
    const badgeAboveMeta = badge.bottom <= meta.top + 1;
    const identityBesideStatus = Math.abs(name.top - badge.top) <= 2;
    record(
      "row reads identity, then status, then metadata",
      "/owner/members",
      viewport,
      badgeAboveMeta && identityBesideStatus,
      `name top ${name.top.toFixed(1)} / badge top ${badge.top.toFixed(1)} bottom ${badge.bottom.toFixed(1)} / meta top ${meta.top.toFixed(1)}${phone ? ` / phone top ${phone.top.toFixed(1)}` : ""}`,
    );
  }

  if (longName) {
    record(
      "a long identity is never clipped horizontally",
      "/owner/members",
      viewport,
      longNameClipped === false,
      `long name "${longNameText ?? ""}" clipped=${longNameClipped} height=${(longNameHeight ?? 0).toFixed(1)}px`,
    );
    record(
      "the full identity is preserved for assistive technology",
      "/owner/members",
      viewport,
      (longNameText ?? "").length >= 40,
      `accessible text length ${(longNameText ?? "").length}`,
    );
    if (longBadge && (longNameHeight ?? 0) > 24) {
      record(
        "a wrapped identity keeps its status beside the first line",
        "/owner/members",
        viewport,
        Math.abs(longBadge.top - longName.top) <= 2,
        `name top ${longName.top.toFixed(1)}, badge top ${longBadge.top.toFixed(1)}`,
      );
    }
  }
}

async function checkEnquiryCapture(page: Page, viewport: string) {
  const toggle = page.getByRole("button", { name: /capture an enquiry/i });
  const visibleBefore = await toggle.isVisible().catch(() => false);
  record(
    "owner enquiry board keeps routine capture secondary",
    "/owner/enquiries",
    viewport,
    visibleBefore,
    "capture toggle reachable below the oversight list",
  );
  if (!visibleBefore) return;

  await toggle.click();
  const nameField = page.locator('[data-testid="enquiry-capture-name"]');
  await nameField.waitFor({ state: "visible", timeout: 10_000 });
  const capturedName = `Browser Check ${Date.now().toString().slice(-6)}`;
  await nameField.fill(capturedName);
  await page.locator('[data-testid="enquiry-capture-submit"]').click();
  await page.waitForTimeout(1500);
  const listed = await page
    .locator('[data-testid="enquiries-list"]')
    .innerText()
    .catch(() => "");
  record(
    "owner enquiry capture still records an enquiry",
    "/owner/enquiries",
    viewport,
    listed.includes(capturedName),
    `row present: ${listed.includes(capturedName)}`,
  );
}

/**
 * The accessible label of a control.
 *
 * `HTMLInputElement.labels` / `HTMLSelectElement.labels` /
 * `HTMLTextAreaElement.labels` cover BOTH associations: an explicit
 * `label[for]` AND an implicit wrapping `<label>`. An id is not
 * required for a valid association, so requiring one would reject a
 * correct control. An `aria-label` / `aria-labelledby` naming is
 * accepted as the accessible name as well.
 */
const LABEL_TEXT_FN = `
  var labelText = function (control) {
    if (control.labels && control.labels.length) {
      var text = Array.prototype.map.call(control.labels, function (label) {
        return (label.textContent || '').trim();
      }).join(' ').trim();
      if (text.length) return text;
    }
    var aria = control.getAttribute('aria-label');
    if (aria && aria.trim().length) return aria.trim();
    var labelledBy = control.getAttribute('aria-labelledby');
    if (labelledBy) {
      var parts = labelledBy.split(/\\s+/).map(function (id) {
        var el = document.getElementById(id);
        return el ? (el.textContent || '').trim() : '';
      }).join(' ').trim();
      if (parts.length) return parts;
    }
    return '';
  };
`;

/**
 * Self-validation of the probe's own classifier: a correct control
 * with an IMPLICIT label, one with an EXPLICIT label, one named by
 * `aria-label` and one with no label at all. A probe that cannot tell
 * these apart would report false positives, so it checks itself before
 * it judges a page.
 */
async function validateLabelProbe(page: Page) {
  const result = (await page.evaluate(`(() => {
    ${LABEL_TEXT_FN}
    var probe = document.createElement('div');
    probe.style.display = 'none';
    probe.innerHTML =
      '<label><span>Wrapped label</span><input id="probe-implicit" type="text"></label>' +
      '<label for="probe-explicit">Explicit label</label><input id="probe-explicit" type="text">' +
      '<input id="probe-aria" type="text" aria-label="Named by aria">' +
      '<input id="probe-none" type="text">';
    document.body.appendChild(probe);
    var out = {
      implicit: labelText(probe.querySelector('#probe-implicit')).length > 0,
      explicit: labelText(probe.querySelector('#probe-explicit')).length > 0,
      aria: labelText(probe.querySelector('#probe-aria')).length > 0,
      none: labelText(probe.querySelector('#probe-none')).length === 0,
    };
    probe.remove();
    return out;
  })()`)) as {
    implicit: boolean;
    explicit: boolean;
    aria: boolean;
    none: boolean;
  };

  record(
    "the probe's label classifier recognises implicit, explicit, aria-named and unlabelled controls",
    "self-check",
    "all",
    result.implicit && result.explicit && result.aria && result.none,
    JSON.stringify(result),
  );
}

async function checkLabelledControls(page: Page, route: string, viewport: string) {
  const unlabelled = (await page.evaluate(`(() => {
    ${LABEL_TEXT_FN}
    // Scoped to the PAGE's own content: the owner shell header owns the
    // global record search, which is a System-owned control and is not
    // part of this page's form. The shell has its own result below.
    var scope = document.querySelector('main') || document.body;
    var controls = Array.prototype.slice.call(
      scope.querySelectorAll('input:not([type=checkbox]), select, textarea'),
    );
    var bad = controls.filter(function (control) {
      return labelText(control).length === 0;
    });
    return bad.map(function (control) {
      return control.outerHTML.slice(0, 80);
    });
  })()`)) as string[];

  record(
    "every text and select control on the page carries an accessible label",
    route,
    viewport,
    unlabelled.length === 0,
    unlabelled.length === 0
      ? "all labelled"
      : `${unlabelled.length} unlabelled: ${unlabelled.join(" | ")}`,
  );
}

/** The shared owner shell's own controls, reported separately from the
 *  page-owned forms. */
async function checkShellControls(page: Page, viewport: string) {
  const unlabelled = (await page.evaluate(`(() => {
    ${LABEL_TEXT_FN}
    var shell = document.querySelector('header') || document.body;
    var controls = Array.prototype.slice.call(
      shell.querySelectorAll('input:not([type=checkbox]), select, textarea'),
    );
    var bad = controls.filter(function (control) {
      return labelText(control).length === 0;
    });
    return bad.map(function (control) {
      return control.outerHTML.slice(0, 80);
    });
  })()`)) as string[];

  record(
    "the shared owner shell's record search carries an accessible label",
    "owner shell",
    viewport,
    unlabelled.length === 0,
    unlabelled.length === 0
      ? "labelled"
      : `${unlabelled.length} unlabelled: ${unlabelled.join(" | ")}`,
  );
}

async function gotoWithRetry(page: Page, url: string) {
  // The preview server is a dev server: it can restart itself when it
  // approaches its memory threshold, which resets one navigation. A
  // reset is a SERVER event, not a page defect, so the navigation is
  // retried once and the fact is reported.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      console.log(
        `navigation to ${url} was reset (attempt ${attempt + 1}); the preview server restarted — retrying`,
      );
      await page.waitForTimeout(3000);
    }
  }
}

/**
 * The control-metric proof: every text/select/date control on an owned
 * owner page must COMPUTE to the shared standard control — 48px high,
 * a 10px radius and 16px text. "It renders" and "it does not overflow"
 * are not control compliance; this measures the used values.
 */
async function checkControlMetrics(page: Page, route: string, viewport: string) {
  const measured = (await page.evaluate(`(() => {
    ${LABEL_TEXT_FN}
    var scope = document.querySelector('main') || document.body;
    var controls = Array.prototype.slice.call(
      scope.querySelectorAll('input, select, textarea'),
    ).filter(function (control) {
      var type = (control.getAttribute('type') || '').toLowerCase();
      return ['checkbox', 'radio', 'file', 'hidden', 'submit', 'button'].indexOf(type) === -1;
    });
    var bad = controls.map(function (control) {
      var style = window.getComputedStyle(control);
      var rect = control.getBoundingClientRect();
      var tag = control.tagName.toLowerCase();
      // A single-line control is exactly the shared standard height; a
      // MULTILINE control is deliberately taller (it grows with the
      // text), so its floor is 48px, not an exact 48px.
      var heightOk =
        tag === 'textarea' ? rect.height >= 48 : Math.round(rect.height) === 48;
      return {
        tag: tag,
        height: Math.round(rect.height),
        radius: style.borderTopLeftRadius,
        fontSize: style.fontSize,
        label: labelText(control).slice(0, 40),
        ok: heightOk && style.borderTopLeftRadius === '10px' && style.fontSize === '16px',
      };
    }).filter(function (entry) {
      return !entry.ok;
    });
    return { total: controls.length, bad: bad };
  })()`)) as {
    total: number;
    bad: Array<{
      tag: string;
      height: number;
      radius: string;
      fontSize: string;
      label: string;
    }>;
  };

  record(
    "every control on the page computes to the shared 48px / 10px / 16px control",
    route,
    viewport,
    measured.bad.length === 0,
    measured.bad.length === 0
      ? `${measured.total} controls at 48px / 10px / 16px`
      : `${measured.bad.length} of ${measured.total} off: ${measured.bad
          .map(
            (entry) =>
              `${entry.tag}[${entry.label}] ${entry.height}px/${entry.radius}/${entry.fontSize}`,
          )
          .join(" | ")}`,
  );
}

/**
 * The open-form geometry for the pickers that live in a FLEX row.
 *
 * The shared `Select` wraps its native `<select>` in its own
 * `relative block` div, so a flex class on the inner select does not
 * size the flex ITEM. The layout therefore has to live in the owned
 * wrapper around the primitive. This check opens the real control
 * (the member's enrolment "Transfer" row) and measures the rendered
 * widths: the picker must take the free width of the row, the row must
 * not overflow, and the page must not gain a horizontal scrollbar.
 */
/**
 * The standard action buttons that sit beside a shared control must
 * carry the shared standard height (48px), not the old 44px pill. They
 * are measured, not asserted from a class string.
 */
async function checkStandardActionMetrics(page: Page, route: string, viewport: string) {
  const measured = (await page.evaluate(`(() => {
    var ids = ['roster-apply', 'raise-invoice', 'facility-add'];
    return ids.map(function (id) {
      var el = document.querySelector('[data-testid="' + id + '"]');
      if (!el) return null;
      var style = window.getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      return {
        id: id,
        height: Math.round(rect.height),
        radius: style.borderTopLeftRadius,
        fontSize: style.fontSize,
      };
    }).filter(Boolean);
  })()`)) as Array<{
    id: string;
    height: number;
    radius: string;
    fontSize: string;
  } | null>;

  const present = (measured ?? []).filter(Boolean) as Array<{
    id: string;
    height: number;
    radius: string;
    fontSize: string;
  }>;
  if (present.length === 0) return;

  record(
    "a standard action beside a shared control is the 48px standard control",
    route,
    viewport,
    present.every(
      (entry) => entry.height === 48 && entry.fontSize === "16px",
    ),
    present
      .map((entry) => `${entry.id} ${entry.height}px/${entry.radius}/${entry.fontSize}`)
      .join(" | "),
  );
}

/**
 * The flex-row picker contract.
 *
 * The shared `Select` wraps its native `<select>` in its own
 * `relative block` div, so a flex class on the inner select does not
 * size the flex ITEM. The layout therefore has to live in a lane-owned
 * wrapper around the primitive. This check measures every picker that
 * sits in a flex row: it must take the free width of that row (it is
 * not sized by its own long options) and the row must not overflow.
 */
async function checkOpenFormGeometry(page: Page, viewport: string) {
  const measured = (await page.evaluate(`(() => {
    var doc = document.documentElement;
    var scope = document.querySelector('main') || document.body;
    var selects = Array.prototype.slice.call(scope.querySelectorAll('select'));
    var rows = selects.map(function (select) {
      var row = select.closest('.flex');
      if (!row) return null;
      var selectBox = select.getBoundingClientRect();
      var rowBox = row.getBoundingClientRect();
      var others = 0;
      Array.prototype.slice.call(row.children).forEach(function (child) {
        if (child === select || child.contains(select)) return;
        var r = child.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) others += r.width;
      });
      return {
        label:
          select.getAttribute('aria-label') ||
          select.getAttribute('data-testid') ||
          'select',
        selectWidth: selectBox.width,
        rowWidth: rowBox.width,
        others: others,
        rowOverflow: row.scrollWidth - row.clientWidth,
        pageOverflow: Math.max(0, doc.scrollWidth - doc.clientWidth),
      };
    }).filter(Boolean);
    return rows;
  })()`)) as Array<{
    label: string;
    selectWidth: number;
    rowWidth: number;
    others: number;
    rowOverflow: number;
    pageOverflow: number;
  } | null>;

  const rows = (measured ?? []).filter(Boolean) as Array<{
    label: string;
    selectWidth: number;
    rowWidth: number;
    others: number;
    rowOverflow: number;
    pageOverflow: number;
  }>;
  if (rows.length === 0) {
    record(
      "a picker in a flex row takes the free width and does not overflow",
      "/owner/members (detail)",
      viewport,
      false,
      "no picker in a flex row was reachable on this page",
    );
    return;
  }

  const detail = rows
    .map((row) => {
      const free = row.rowWidth - row.others - 8;
      const ok =
        row.selectWidth >= free - 2 &&
        row.rowOverflow <= 1 &&
        row.pageOverflow <= 1;
      return `${row.label}: ${row.selectWidth.toFixed(1)}px of ${free.toFixed(1)}px free (row ${row.rowWidth.toFixed(1)}px), overflow ${row.rowOverflow}/${row.pageOverflow}${ok ? " OK" : " OFF"}`;
    })
    .join(" | ");

  record(
    "a picker in a flex row takes the free width and does not overflow",
    "/owner/members (detail)",
    viewport,
    rows.every((row) => {
      const free = row.rowWidth - row.others - 8;
      return (
        row.selectWidth >= free - 2 &&
        row.rowOverflow <= 1 &&
        row.pageOverflow <= 1
      );
    }),
    detail,
  );
}


/**
 * The inline editor's select, opened for real: the ref must land on
 * the native select, the control must take focus, it must wear the
 * shared standard metrics, and choosing an option must save.
 */
async function checkInlineSelectInteraction(page: Page, viewport: string) {
  const editButton = page.getByRole("button", { name: "Edit gender" }).first();
  if (!(await editButton.isVisible().catch(() => false))) {
    record(
      "the inline select opens, focuses, measures and saves",
      "/owner/members (detail)",
      viewport,
      false,
      "the gender inline editor was not reachable on this page",
    );
    return;
  }
  await editButton.click();

  const select = page.locator('main select[aria-label="gender"]');
  const opened = await select
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    record(
      "the inline select opens, focuses, measures and saves",
      "/owner/members (detail)",
      viewport,
      false,
      "the inline select did not open",
    );
    return;
  }

  const measured = (await page.evaluate(`(() => {
    var select = document.querySelector('main select[aria-label="gender"]');
    if (!select) return null;
    var style = window.getComputedStyle(select);
    var rect = select.getBoundingClientRect();
    return {
      tag: select.tagName,
      focused: document.activeElement === select,
      height: Math.round(rect.height),
      radius: style.borderTopLeftRadius,
      fontSize: style.fontSize,
      options: Array.prototype.map.call(select.options, function (option) {
        return option.value;
      }),
    };
  })()`)) as {
    tag: string;
    focused: boolean;
    height: number;
    radius: string;
    fontSize: string;
    options: string[];
  } | null;

  if (!measured) {
    record(
      "the inline select opens, focuses, measures and saves",
      "/owner/members (detail)",
      viewport,
      false,
      "the inline select could not be measured",
    );
    return;
  }

  // The save: choose the next option and let the field commit.
  const before = await page
    .locator('main select[aria-label="gender"]')
    .evaluate((element) => (element as HTMLSelectElement).value)
    .catch(() => "");
  // A REAL change, not the value that is already set.
  const choices = ["male", "female", "other"];
  const nextValue =
    choices.find((choice) => choice !== before && measured.options.includes(choice)) ??
    "other";
  await select.selectOption(nextValue);
  await page.waitForTimeout(1500);
  const stillEditing = await select.isVisible().catch(() => false);

  // The editor closes OPTIMISTICALLY, so a closing editor proves
  // nothing about the save. The save is proved by a READ-BACK: reload
  // the page and read the stored value, and require that no failure
  // alert was shown in between.
  const failureAlert = await page
    .locator('main [role="alert"]')
    .first()
    .innerText()
    .catch(() => "");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
  const readBack = (await page.evaluate(`(() => {
    var terms = Array.prototype.slice.call(document.querySelectorAll('main dt'));
    var term = terms.filter(function (el) {
      return (el.textContent || '').trim() === 'Gender';
    })[0];
    var value = term && term.nextElementSibling
      ? (term.nextElementSibling.textContent || '').trim()
      : '';
    return value;
  })()`)) as string;

  record(
    "the inline select opens, focuses, measures and SAVES (persisted read-back)",
    "/owner/members (detail)",
    viewport,
    measured.tag === "SELECT" &&
      measured.focused &&
      measured.height === 48 &&
      measured.radius === "10px" &&
      measured.fontSize === "16px" &&
      !stillEditing &&
      failureAlert === "" &&
      readBack.toLowerCase() === nextValue.toLowerCase(),
    `native ${measured.tag}, focused ${measured.focused}, ${measured.height}px/${measured.radius}/${measured.fontSize}, chose ${nextValue} (was ${before || "(empty)"}), editor closed ${!stillEditing}, failure alert "${failureAlert}", read-back "${readBack}"`,
  );
}


/**
 * The enquiry trial workflow, OPENED: the confirm action must be the
 * shared standard control (48px / 10px / 16px), not the old
 * 44px / 14px treatment.
 */
async function checkEnquiryWorkflowMetrics(page: Page, viewport: string) {
  const bookTrial = page.locator('[data-testid="show-book-trial"]');
  if (!(await bookTrial.isVisible().catch(() => false))) {
    record(
      "the opened enquiry workflow uses the shared standard action",
      "/owner/enquiries (detail)",
      viewport,
      false,
      "the trial workflow was not reachable on this enquiry",
    );
    return;
  }
  await bookTrial.click();
  const confirm = page.locator('[data-testid="submit-book-trial"]');
  const opened = await confirm
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    record(
      "the opened enquiry workflow uses the shared standard action",
      "/owner/enquiries (detail)",
      viewport,
      false,
      "the trial form did not open",
    );
    return;
  }

  const measured = (await page.evaluate(`(() => {
    var button = document.querySelector('[data-testid="submit-book-trial"]');
    if (!button) return null;
    var style = window.getComputedStyle(button);
    var rect = button.getBoundingClientRect();
    return {
      tag: button.tagName,
      height: Math.round(rect.height),
      radius: style.borderTopLeftRadius,
      fontSize: style.fontSize,
      disabled: button.disabled,
      label: (button.textContent || '').trim(),
    };
  })()`)) as {
    tag: string;
    height: number;
    radius: string;
    fontSize: string;
    disabled: boolean;
    label: string;
  } | null;

  if (!measured) {
    record(
      "the opened enquiry workflow uses the shared standard action",
      "/owner/enquiries (detail)",
      viewport,
      false,
      "the confirm action could not be measured",
    );
    return;
  }

  record(
    "the opened enquiry trial workflow uses the shared standard action",
    "/owner/enquiries (detail)",
    viewport,
    measured.tag === "BUTTON" &&
      measured.height === 48 &&
      measured.radius === "10px" &&
      measured.fontSize === "16px",
    `${measured.label}: ${measured.height}px/${measured.radius}/${measured.fontSize} (disabled ${measured.disabled})`,
  );

  // The CONVERSION workflow is a second hidden form: open it too and
  // measure its own confirm action.
  const showConvert = page.locator('[data-testid="show-convert"]');
  if (!(await showConvert.isVisible().catch(() => false))) {
    record(
      "the opened enquiry conversion workflow uses the shared standard action",
      "/owner/enquiries (detail)",
      viewport,
      false,
      "the conversion workflow was not reachable on this enquiry",
    );
    return;
  }
  await showConvert.click();
  const confirmConvert = page.locator('[data-testid="submit-convert"]');
  const convertOpened = await confirmConvert
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!convertOpened) {
    record(
      "the opened enquiry conversion workflow uses the shared standard action",
      "/owner/enquiries (detail)",
      viewport,
      false,
      "the conversion form did not open",
    );
    return;
  }
  const convertMeasured = (await page.evaluate(`(() => {
    var button = document.querySelector('[data-testid="submit-convert"]');
    if (!button) return null;
    var style = window.getComputedStyle(button);
    var rect = button.getBoundingClientRect();
    return {
      tag: button.tagName,
      height: Math.round(rect.height),
      radius: style.borderTopLeftRadius,
      fontSize: style.fontSize,
      disabled: button.disabled,
      label: (button.textContent || '').trim(),
    };
  })()`)) as {
    tag: string;
    height: number;
    radius: string;
    fontSize: string;
    disabled: boolean;
    label: string;
  } | null;

  record(
    "the opened enquiry conversion workflow uses the shared standard action",
    "/owner/enquiries (detail)",
    viewport,
    Boolean(
      convertMeasured &&
        convertMeasured.tag === "BUTTON" &&
        convertMeasured.height === 48 &&
        convertMeasured.radius === "10px" &&
        convertMeasured.fontSize === "16px",
    ),
    convertMeasured
      ? `${convertMeasured.label}: ${convertMeasured.height}px/${convertMeasured.radius}/${convertMeasured.fontSize} (disabled ${convertMeasured.disabled})`
      : "the conversion action could not be measured",
  );
}

async function checkMemberHeader(page: Page, viewport: string) {
  const header = (await page.evaluate(`(() => {
    var h1 = document.querySelector('h1');
    if (!h1) return null;
    var row = h1.parentElement;
    if (!row) return null;
    var pill = row.querySelector('.rounded-pill');
    return {
      text: (row.textContent || '').trim(),
      pillText: pill ? (pill.textContent || '').trim() : null,
    };
  })()`)) as { text: string; pillText: string | null } | null;

  record(
    "the member header carries the lifecycle state beside the identity",
    "/owner/members (detail)",
    viewport,
    Boolean(header && header.pillText && header.pillText.length > 0),
    header
      ? `header="${header.text}" state pill="${header.pillText ?? "none"}"`
      : "no header found",
  );
}

async function checkImportReview(page: Page, viewport: string) {
  // The template is the review fixture: it carries one example row, so
  // the review step is reached without importing anything.
  const response = await page.request.get(`${BASE}/owner/members/import/template.csv`);
  const csv = await response.text();
  const file = join(OUT, "member-import-template.csv");
  writeFileSync(file, csv);

  const input = page.locator('#member-import-file');
  await input.setInputFiles(file);
  const preview = page.locator('[data-testid="import-preview-file"]');
  const appeared = await preview
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);

  const text = appeared ? await page.locator("main").innerText() : "";
  record(
    "the import review states the reviewed file and the row outcome",
    "/owner/members/import",
    viewport,
    appeared && /ready|need/i.test(text),
    appeared
      ? `preview shown: ${text.replace(/\s+/g, " ").slice(0, 160)}`
      : "the preview did not appear",
  );
}

async function checkReceptionCollectPayment(browser: Browser) {
  // The counter payment forms are reception surfaces that this lane also
  // owns; they are checked as the RECEPTION role, with the real
  // receptionist credentials, so the shared controls are proved in the
  // journey that uses them.
  // A FRESH context: the owner context is already signed in, and the
  // login route redirects an authenticated owner away from the form.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.fill("#login-phone", RECEPTION_PHONE);
    await page.fill("#login-pin", PIN);
    await page.locator("#login-pin").blur();
    await page.waitForTimeout(800);
    const submit = page.locator('form button[type="submit"]');
    const enabled = await submit.isEnabled();
    if (!enabled) {
      record(
        "the reception counter screen renders its shared controls",
        "/reception/collect-payment",
        "phone",
        false,
        "the reception sign-in button never became enabled",
      );
      return;
    }
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 30_000,
      }),
      submit.click(),
    ]);
    await page.goto(`${BASE}/reception/collect-payment`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);

    const metrics = (await page.evaluate(`(() => {
      ${LABEL_TEXT_FN}
      var controls = Array.prototype.slice.call(
        document.querySelectorAll('input:not([type=checkbox]):not([type=file]), select, textarea'),
      );
      var unlabelled = controls.filter(function (control) {
        return labelText(control).length === 0;
      });
      var heights = controls.map(function (control) {
        return Math.round(control.getBoundingClientRect().height);
      });
      return { count: controls.length, unlabelled: unlabelled.length, heights: heights };
    })()`)) as { count: number; unlabelled: number; heights: number[] };

    record(
      "the reception counter screen uses the shared 48px labelled controls",
      "/reception/collect-payment",
      "phone",
      metrics.count > 0 &&
        metrics.unlabelled === 0 &&
        metrics.heights.every((height) => height === 48),
      `${metrics.count} controls, ${metrics.unlabelled} unlabelled, heights ${metrics.heights.join("/")}px`,
    );
  } finally {
    await page.close();
    await context.close().catch(() => {});
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
    });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(String(error)));

    await signIn(context);
    await validateLabelProbe(page);

    // The member detail and edit routes need a real member id.
    await gotoWithRetry(page, `${BASE}/owner/members`);
    await settle(page);
    const firstMemberHref = await page
      .locator('[data-testid="member-row"]')
      .first()
      .getAttribute("href")
      .catch(() => null);
    // The FIXTURE member (the long name) has no batch enrolments, so its
    // "enrol in" picker is reachable — the enrolment picker's layout is
    // one of the rows under review.
    const fixtureMemberHref = await page
      .locator('[data-testid="member-row"]')
      .filter({
        has: page.locator('[data-testid="member-row-name"]'),
      })
      .evaluateAll((rows) => {
        const long = rows.find((row) => {
          const name = row.querySelector('[data-testid="member-row-name"]');
          return (name?.textContent ?? "").length > 28;
        });
        return long?.getAttribute("href") ?? null;
      })
      .catch(() => null);
    const detailHref = fixtureMemberHref ?? firstMemberHref;
    const memberRoutes = detailHref
      ? [
          { path: detailHref, name: "member-detail" },
          { path: `${detailHref}/edit`, name: "member-edit" },
        ]
      : [];

    // The enquiry detail route needs a real enquiry id.
    await gotoWithRetry(page, `${BASE}/owner/enquiries`);
    await settle(page);
    const firstEnquiryHref = await page
      .locator('[data-testid="enquiries-list"] a')
      .first()
      .getAttribute("href")
      .catch(() => null);
    const enquiryRoutes = firstEnquiryHref
      ? [{ path: firstEnquiryHref, name: "enquiry-detail" }]
      : [];

    // The staff profile route needs a real staff id.
    await gotoWithRetry(page, `${BASE}/owner/staff`);
    await settle(page);
    const firstStaffHref = await page
      .locator('[data-testid="staff-list"] a')
      .first()
      .getAttribute("href")
      .catch(() => null);
    const staffRoutes = firstStaffHref
      ? [{ path: firstStaffHref, name: "staff-detail" }]
      : [];

    // An affected-route run may name the routes it covers; the default
    // is the whole owned set.
    const receptionOnly = process.env.AQUA_E2E_ONLY === "reception";
    const only = (process.env.AQUA_E2E_ROUTES ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const all = [
      ...ROUTES,
      ...memberRoutes,
      ...staffRoutes,
      ...enquiryRoutes,
    ];
    const selected = receptionOnly
      ? []
      : only.length
        ? all.filter((route) => only.includes(route.name))
        : all;

    const allRoutes = selected;

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of allRoutes) {
        await gotoWithRetry(page, `${BASE}${route.path}`);
        await settle(page);
        const overflow = await horizontalOverflow(page);
        record(
          "no horizontal page overflow",
          route.path,
          viewport.name,
          overflow <= 1,
          `overflow ${overflow}px`,
        );
        const heading = await page.locator("h1").first().innerText().catch(() => "");
        record(
          "page renders its heading",
          route.path,
          viewport.name,
          heading.trim().length > 0,
          `h1="${heading.trim()}"`,
        );
        await page.screenshot({
          path: join(OUT, `${route.name}-${viewport.name}.png`),
          fullPage: false,
        });

        if (route.path === "/owner/members") await checkMembers(page, viewport.name);
        // The control-metric proof runs on every owned owner page.
        await checkControlMetrics(page, route.path, viewport.name);
        await checkStandardActionMetrics(page, route.path, viewport.name);
        if (route.name === "enquiry-detail") {
          await checkEnquiryWorkflowMetrics(page, viewport.name);
        }
        if (route.name === "member-detail") {
          await checkMemberHeader(page, viewport.name);
          await checkOpenFormGeometry(page, viewport.name);
          await checkInlineSelectInteraction(page, viewport.name);
        }
        if (route.name === "members-import") {
          await checkImportReview(page, viewport.name);
        }
        if (
          route.name === "members-new" ||
          route.name === "member-edit" ||
          route.name === "staff-new" ||
          route.name === "staff-invitations-new"
        ) {
          await checkLabelledControls(page, route.path, viewport.name);
        }
        if (route.name === "members") {
          await checkShellControls(page, viewport.name);
        }
        if (route.path === "/owner/enquiries" && viewport.name === "desktop") {
          await checkEnquiryCapture(page, viewport.name);
        }
      }
    }

    await checkReceptionCollectPayment(browser);

    record(
      "no console/page errors during the run",
      "all",
      "all",
      consoleErrors.length === 0,
      consoleErrors.slice(0, 5).join(" | ") || "none",
    );
  } catch (error) {
    console.error("browser evidence failed:", error);
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    writeReport();
  }
}

function writeReport() {
  const failed = findings.filter((f) => !f.ok);
  const report = {
    base: BASE,
    out: OUT,
    generatedAt: new Date().toISOString(),
    total: findings.length,
    failed: failed.length,
    pending: pending.length,
    findings,
    pendingMeasurements: pending,
  };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  for (const finding of pending) {
    console.log(
      `${finding.ok ? "MET" : "PENDING"} ${finding.check} · ${finding.route} · ${finding.viewport} — ${finding.detail}`,
    );
  }
  console.log(`\n${findings.length - failed.length}/${findings.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("browser evidence failed:", error);
  process.exitCode = 1;
});
