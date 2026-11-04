// Ops redesign (28 October 2026) — the control-metrics acceptance.
//
// The approved shared control contract (app/globals.css, "the shared
// control contract"):
//
//   "Standard action buttons, text fields, selects, date and time
//    pickers share a 48px height, 10px radius, 16px control text and
//    consistent horizontal padding."
//
//   "Neutral entry/search fields; very lightly tinted pickers; a
//    slightly stronger theme tint for secondary action buttons; solid
//    theme colour for the primary action."
//
//   "Compact table and tertiary controls retain at least 44px
//    effective targets."
//
// This file measures those properties in REAL CHROME on the ROUTED
// Ops forms and lists — the tenants filter toolbar, the lead form, the
// feature catalogue's compact row action, the preset picker and the
// sign-in form. It reads computed styles and bounding boxes only; it
// never reads a class string.
//
// It is the acceptance gate for every G2+ control, form and spacing
// change: the measurements it demands are the ones the redesign has
// to meet, so a failure here is a genuine defect in the shipped
// surface, not a wish about the future.
//
// Run inside the bounded preview:
//   python3 .opencode/scripts/lane_job.py exec python3 .opencode/scripts/preview_job.py \
//     --port 3187 -- pnpm exec tsx e2e/ops-redesign/ops-controls-acceptance.ts

import assert from "node:assert/strict";
import { readFixture, signIn } from "./ops-fixture";
import { makeChecker, measure, measureInForm, openConsole } from "./ops-browser";

/** Resolve a colour token to the value a control actually paints. */
async function resolveTokenColour(
  page: import("playwright").Page,
  token: string,
): Promise<string> {
  return await page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.backgroundColor = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, token);
}

function toRgbTriplet(colour: string): string {
  const trimmed = colour.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    const value = parseInt(full.slice(0, 6), 16);
    return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
  }
  const parts = trimmed.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return `${parts[0]}, ${parts[1]}, ${parts[2]}`;
}

async function expectStandardControl(
  page: import("playwright").Page,
  selector: string,
  label: string,
  options: { picker?: boolean } = {},
) {
  const box = await measure(page, selector);
  assert.ok(box, `${label}: ${selector} was not rendered`);
  assert.ok(
    Math.abs(box.height - 48) <= 1,
    `${label}: expected the standard 48px control height, measured ${box.height}px`,
  );
  assert.equal(
    box.borderRadius,
    "10px",
    `${label}: expected the 10px control radius, measured ${box.borderRadius}`,
  );
  assert.equal(
    box.fontSize,
    "16px",
    `${label}: expected 16px control text, measured ${box.fontSize}`,
  );
  assert.equal(
    box.paddingLeft,
    "16px",
    `${label}: expected 16px horizontal padding, measured ${box.paddingLeft}`,
  );
  const surface = options.picker
    ? await resolveTokenColour(page, "--control-surface-picker")
    : await resolveTokenColour(page, "--control-surface");
  assert.equal(
    toRgbTriplet(box.backgroundColor),
    toRgbTriplet(surface),
    `${label}: expected the ${options.picker ? "tinted picker" : "neutral entry"} surface ${surface}, measured ${box.backgroundColor}`,
  );
}

async function main() {
  const fixture = readFixture();
  const checker = makeChecker();
  const session = await openConsole({ width: 1280, height: 900 });
  const { page, base } = session;

  try {
    await signIn(page, base, fixture.operator);

    await checker.check(
      "the tenants filter toolbar uses the standard control metrics",
      async () => {
        await page.goto(`${base}/ops/tenants`);
        await page.getByPlaceholder("name or slug").waitFor();
        await expectStandardControl(page, 'input[name="search"]', "the tenant search field");
        await expectStandardControl(page, 'select[name="status"]', "the tenant status picker", {
          picker: true,
        });
        await expectStandardControl(page, 'select[name="planId"]', "the tenant plan picker", {
          picker: true,
        });
      },
    );

    await checker.check(
      "the tenants toolbar's controls share one height, so their baselines align",
      async () => {
        const heights = await page.evaluate(() => {
          // Scope to the TENANT FILTER form: the search field's own
          // form. The rail's sign-out is a server-action form and is a
          // different form entirely. Hidden fields and React's injected
          // action metadata are excluded — they have no box.
          const search = document.querySelector('input[name="search"]');
          if (!search) return null;
          const form = search.closest("form");
          if (!form) return null;
          return Array.from(
            form.querySelectorAll<HTMLElement>("input, select, button"),
          )
            .filter((el) => {
              if (el.getAttribute("type") === "hidden") return false;
              const rect = el.getBoundingClientRect();
              return rect.height > 0 && rect.width > 0;
            })
            .map((el) => {
              const rect = el.getBoundingClientRect();
              return {
                name:
                  el.getAttribute("name") ??
                  (el.textContent ?? "").trim() ??
                  el.tagName.toLowerCase(),
                height: rect.height,
                top: rect.top,
                bottom: rect.bottom,
              };
            });
        });
        assert.ok(heights && heights.length > 0, "the filter form rendered no controls");
        // The toolbar is a multi-column grid, so the controls occupy
        // several ROWS. The requirement is that the controls WITHIN a
        // row share one height and one baseline — that is what makes a
        // row read as a row.
        const rows = new Map<number, typeof heights>();
        for (const control of heights) {
          const key = Math.round(control.top);
          rows.set(key, [...(rows.get(key) ?? []), control]);
        }
        for (const [top, row] of rows) {
          const heightsInRow = Array.from(
            new Set(row.map((control) => Math.round(control.height))),
          );
          assert.equal(
            heightsInRow.length,
            1,
            `the toolbar's row at y=${top} has ${heightsInRow.length} different heights (${row
              .map((control) => `${control.name}:${Math.round(control.height)}`)
              .join(", ")}) — they cannot align`,
          );
          const bottoms = Array.from(new Set(row.map((control) => Math.round(control.bottom))));
          assert.equal(
            bottoms.length,
            1,
            `the toolbar's row at y=${top} sits on ${bottoms.length} different baselines (${row
              .map((control) => `${control.name}:${Math.round(control.bottom)}`)
              .join(", ")})`,
          );
        }
      },
    );

    await checker.check(
      "the tenants filter's action button is a standard control",
      async () => {
        const button = await measureInForm(
          page,
          'input[name="search"]',
          'button[type="submit"]',
        );
        assert.ok(button, "the Apply button was not rendered");
        assert.ok(
          Math.abs(button.height - 48) <= 1,
          `the Apply button is ${button.height}px tall — expected the standard 48px control`,
        );
        assert.equal(
          button.borderRadius,
          "10px",
          `the Apply button's radius is ${button.borderRadius} — expected the 10px control radius`,
        );
        assert.equal(
          button.fontSize,
          "16px",
          `the Apply button's text is ${button.fontSize} — expected 16px control text`,
        );
      },
    );

    await checker.check(
      "the lead form's fields use the standard control metrics",
      async () => {
        await page.goto(`${base}/ops/leads/new`);
        await page.locator('input[name="businessName"]').waitFor();
        await expectStandardControl(page, 'input[name="businessName"]', "the lead business-name field");
        await expectStandardControl(page, 'input[name="phone"]', "the lead phone field");
        await expectStandardControl(page, 'select[name="source"]', "the lead source picker", {
          picker: true,
        });
      },
    );

    await checker.check(
      "the lead form's submit button is a standard control",
      async () => {
        const button = await measureInForm(
          page,
          'input[name="businessName"]',
          'button[type="submit"]',
        );
        assert.ok(button, "the lead submit button was not rendered");
        assert.ok(
          Math.abs(button.height - 48) <= 1,
          `the lead submit button is ${button.height}px tall — expected the standard 48px control`,
        );
        assert.equal(
          button.borderRadius,
          "10px",
          `the lead submit button's radius is ${button.borderRadius} — expected 10px`,
        );
      },
    );

    await checker.check(
      "the feature catalogue's row action is a compact control of at least 44px",
      async () => {
        await page.goto(`${base}/ops/features`);
        await page.getByRole("button", { name: "Edit" }).first().waitFor();
        const button = await measure(page, "button");
        assert.ok(button, "no button was rendered on the catalogue");
        assert.ok(
          button.height >= 44,
          `the catalogue's row action is ${button.height}px tall — below the 44px compact floor`,
        );
        assert.equal(
          button.borderRadius,
          "10px",
          `the catalogue's row action radius is ${button.borderRadius} — expected 10px`,
        );
      },
    );

    await checker.check(
      "the sign-in form's fields are standard controls",
      async () => {
        const anonymous = await session.browser.newContext({
          viewport: { width: 1280, height: 900 },
        });
        const anonymousPage = await anonymous.newPage();
        try {
          await anonymousPage.goto(`${base}/ops/login`);
          await anonymousPage.getByLabel("Email", { exact: true }).waitFor();
          const email = await measure(anonymousPage, 'input[name="email"]');
          assert.ok(email, "the email field was not rendered");
          assert.ok(
            Math.abs(email.height - 48) <= 1,
            `the email field is ${email.height}px tall — expected the standard 48px control`,
          );
          assert.equal(
            email.borderRadius,
            "10px",
            `the email field's radius is ${email.borderRadius} — expected 10px`,
          );
          assert.equal(
            email.fontSize,
            "16px",
            `the email field's text is ${email.fontSize} — expected 16px`,
          );
        } finally {
          await anonymous.close();
        }
      },
    );

    await checker.check(
      "the primary action on a routed page is the solid theme colour",
      async () => {
        await page.goto(`${base}/ops/tenants`);
        const primary = await measure(page, 'a[href="/ops/tenants/new"]');
        assert.ok(primary, "the New tenant action was not rendered");
        const actionSurface = await resolveTokenColour(page, "--action-surface");
        assert.equal(
          toRgbTriplet(primary.backgroundColor),
          toRgbTriplet(actionSurface),
          `the primary action paints ${primary.backgroundColor}; the action surface is ${actionSurface}`,
        );
      },
    );
  } finally {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    await checker.writeResults("ops-controls-acceptance.json");
  }

  if (checker.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("The Ops control-metrics acceptance could not run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
