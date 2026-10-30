// Ops redesign (28 October 2026) — the ROUTED focus coverage.
//
// A source string cannot tell whether an outline actually draws: the
// Tailwind v4 `outline-none` trap sets `--tw-outline-style: none`, and
// `outline-style: var(--tw-outline-style)` then resolves to none at
// paint time even though the source says `outline-2`. The rendered
// contract is the only one that counts.
//
// This check visits EVERY routed Ops surface that owns a form control,
// focuses a representative control the way a keyboard user reaches it,
// and reads the COMPUTED outline — in BOTH approved presets, because
// the focus ring is a per-preset token.
//
// Run inside the bounded preview:
//   python3 .opencode/scripts/lane_job.py exec python3 .opencode/scripts/preview_job.py \
//     --port 3187 -- pnpm exec tsx e2e/ops-redesign/ops-focus-routed.ts

import assert from "node:assert/strict";
import { readFixture, signIn } from "./ops-fixture";
import { makeChecker, openConsole } from "./ops-browser";
import { listPresets } from "@/db/platform-presets";

type Target = {
  /** The console route, relative to the console origin. */
  path: string;
  /** A representative control on that route. */
  selector: string;
  /** A human name for the report. */
  label: string;
};

async function main() {
  const fixture = readFixture();
  const checker = makeChecker();
  const session = await openConsole({ width: 1280, height: 900 });
  const { page, base } = session;

  const preset = (await listPresets()).find((p) => p.status === "active");
  assert.ok(preset, "the platform catalogue has no active preset to open");

  const tenant = fixture.tenantId;

  // Every routed Ops surface that owns a form control. The fourteen
  // files the source-level focus guard names map onto these screens.
  // Every selector below names ONE control on ONE surface.
  //
  // The first run of this check used bare `input` and `button`
  // selectors, and they were wrong twice over: on the GST page a bare
  // `input` matched the HIDDEN React action field rather than the rate
  // field, and a bare `button` can match the rail's exit control. A
  // probe now names the control it means — a form field by its name, a
  // button by its accessible name, a picker by its own test hook.
  const authenticatedTargets: Target[] = [
    {
      path: "/ops/tenants",
      selector: 'input[name="search"]',
      label: "the tenants filter",
    },
    {
      path: "/ops/tenants/new",
      selector: 'input[name="name"]',
      label: "the new-tenant form",
    },
    {
      path: `/ops/tenants/${tenant}`,
      selector: 'button:has-text("Suspend")',
      label: "the tenant status controls",
    },
    {
      path: `/ops/tenants/${tenant}`,
      selector: 'input[name="fullName"]',
      label: "the invite-owner form",
    },
    {
      path: `/ops/tenants/${tenant}/configuration`,
      selector: '[data-testid="ops-tenant-selector"]',
      label: "the configuration tenant picker",
    },
    {
      path: `/ops/tenants/${tenant}/configuration`,
      selector: 'button:has-text("Resolve")',
      label: "the change-request decisions",
    },
    {
      path: `/ops/tenants/${tenant}/tax`,
      selector: 'input[aria-label^="GST percent"]',
      label: "the GST rate form",
    },
    {
      path: "/ops/leads/new",
      selector: 'input[name="businessName"]',
      label: "the new-lead form",
    },
    {
      path: `/ops/leads/${fixture.leadId}`,
      selector: 'button:has-text("Mark qualified")',
      label: "the lead actions",
    },
    {
      path: "/ops/features",
      selector: 'button:has-text("Edit")',
      label: "the feature catalogue",
    },
    {
      path: `/ops/presets/${preset.key}`,
      selector: '[data-testid="ops-preset-tenant-select"]',
      label: "the preset apply form",
    },
    {
      path: "/ops/whatsapp",
      selector: 'input[name="toPhone"]',
      label: "the WhatsApp mock",
    },
  ];

  async function probe(selector: string): Promise<{
    matches: boolean;
    style: string;
    width: number;
    colour: string;
  }> {
    const target = page.locator(selector).first();
    await target.waitFor({ state: "visible" });
    await target.focus();
    // A keyboard press and its undo put the focus back on the control
    // WITH KEYBOARD MODALITY, which is what :focus-visible matches.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    return await target.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        matches: element.matches(":focus-visible"),
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
        colour: style.outlineColor,
      };
    });
  }

  try {
    await signIn(page, base, fixture.operator);

    for (const theme of ["mint", "lavender"] as const) {
      await page.context().addCookies([
        { name: "aqua_theme", value: theme, url: base },
      ]);

      for (const target of authenticatedTargets) {
        const only = process.env.AQUA_OPS_FOCUS_ONLY;
        if (only && !target.label.includes(only)) continue;
        await checker.check(
          `${theme}: ${target.label} draws a visible keyboard focus ring`,
          async () => {
            const response = await page.goto(`${base}${target.path}`, {
              waitUntil: "domcontentloaded",
            });
            assert.equal(
              response?.status(),
              200,
              `${target.path} answered ${response?.status()}`,
            );
            await page.waitForLoadState("load");
            const result = await probe(target.selector);
            assert.equal(
              result.matches,
              true,
              `${target.path}: ${target.selector} did not match :focus-visible`,
            );
            assert.notEqual(
              result.style,
              "none",
              `${target.path}: ${target.selector} painted no outline (outline-style: none)`,
            );
            assert.ok(
              result.width >= 2,
              `${target.path}: ${target.selector} outline is ${result.width}px wide`,
            );
            assert.ok(
              !/rgba?\([^)]*,\s*0\s*\)$/.test(result.colour),
              `${target.path}: ${target.selector} outline is transparent (${result.colour})`,
            );
          },
        );
      }
    }

    // The sign-in form is public: each scenario gets its OWN isolated
    // context, closed in its own finally. Reusing one context would
    // carry the previous scenario's cookies into the next — and an
    // authenticated context would send /ops/login straight past the
    // form to the console, so the second scenario would never see the
    // field it is supposed to probe. No human profile is touched.
    for (const theme of ["mint", "lavender"] as const) {
      const anonymous = await session.browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      const anonymousPage = await anonymous.newPage();
      try {
        await anonymousPage.context().addCookies([
          { name: "aqua_theme", value: theme, url: base },
        ]);
        await checker.check(
          `${theme}: the sign-in form draws a visible keyboard focus ring`,
          async () => {
            await anonymousPage.goto(`${base}/ops/login`);
            await anonymousPage.getByLabel("Email", { exact: true }).waitFor();
            const target = anonymousPage.getByLabel("Email", { exact: true });
            await target.focus();
            await anonymousPage.keyboard.press("Tab");
            await anonymousPage.keyboard.press("Shift+Tab");
            const result = await target.evaluate((element) => {
              const style = getComputedStyle(element);
              return {
                matches: element.matches(":focus-visible"),
                style: style.outlineStyle,
                width: parseFloat(style.outlineWidth),
                colour: style.outlineColor,
              };
            });
            assert.equal(result.matches, true, "the email field is not :focus-visible");
            assert.notEqual(result.style, "none", "the email field painted no outline");
            assert.ok(result.width >= 2, `the email outline is ${result.width}px wide`);
          },
        );
      } finally {
        await anonymous.close();
      }
    }

    // The authenticator screen needs a PENDING challenge: the password
    // step has to be completed first. A fresh context per theme, so the
    // second theme starts a NEW challenge instead of finding the first
    // one already spent.
    for (const theme of ["mint", "lavender"] as const) {
      const pending = await session.browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      const pendingPage = await pending.newPage();
      try {
        await pendingPage.context().addCookies([
          { name: "aqua_theme", value: theme, url: base },
        ]);
        await checker.check(
          `${theme}: the authenticator screen draws a visible keyboard focus ring`,
          async () => {
            await pendingPage.goto(`${base}/ops/login`);
            await pendingPage.getByLabel("Email", { exact: true }).waitFor();
            await pendingPage.getByLabel("Email", { exact: true }).fill(fixture.operator.email);
            await pendingPage
              .getByLabel("Password", { exact: true })
              .fill(fixture.operator.password);
            await pendingPage.getByRole("button", { name: "Continue", exact: true }).click();
            await pendingPage.waitForURL("**/ops/verify");
            const target = pendingPage.getByLabel("6-digit code", { exact: true });
            await target.waitFor();
            await target.focus();
            await pendingPage.keyboard.press("Tab");
            await pendingPage.keyboard.press("Shift+Tab");
            const result = await target.evaluate((element) => {
              const style = getComputedStyle(element);
              return {
                matches: element.matches(":focus-visible"),
                style: style.outlineStyle,
                width: parseFloat(style.outlineWidth),
                colour: style.outlineColor,
              };
            });
            assert.equal(result.matches, true, "the code field is not :focus-visible");
            assert.notEqual(result.style, "none", "the code field painted no outline");
            assert.ok(result.width >= 2, `the code outline is ${result.width}px wide`);
          },
        );
      } finally {
        await pending.close();
      }
    }
  } finally {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    await checker.writeResults("ops-focus-routed.json");
  }

  if (checker.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("The routed Ops focus check could not run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
