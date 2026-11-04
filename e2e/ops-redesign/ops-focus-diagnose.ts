// Ops redesign (28 October 2026) — a FOCUSED diagnostic for the routed
// focus check's probes.
//
// The first routed-focus run failed on three probes. Two of them were
// the harness's fault (a bare `input` selector matched a HIDDEN React
// action field; a bare `button` selector can match the rail's exit
// control). The third — the invite-owner form's field missing for an
// admin — must be investigated, not assumed.
//
// This script prints what the pages ACTUALLY contain: the loaded URL,
// the heading, and the visible form controls of the intended form.
//
// It is a diagnostic, not a pass/fail gate: it prints and exits 0.
//
// Run inside the bounded preview:
//   python3 .opencode/scripts/lane_job.py exec python3 .opencode/scripts/preview_job.py \
//     --port 3187 -- pnpm exec tsx e2e/ops-redesign/ops-focus-diagnose.ts

import { readFixture, signIn } from "./ops-fixture";
import { openConsole } from "./ops-browser";

async function main() {
  const fixture = readFixture();
  const session = await openConsole({ width: 1280, height: 900 });
  const { page, base } = session;

  try {
    await signIn(page, base, fixture.operator);
    console.log("signed in as the synthetic admin operator");

    const pages = [
      { path: `/ops/tenants/${fixture.tenantId}`, label: "tenant overview" },
      {
        path: `/ops/tenants/${fixture.tenantId}/configuration`,
        label: "tenant configuration",
      },
      {
        path: `/ops/tenants/${fixture.tenantId}/tax`,
        label: "tenant GST",
      },
      { path: `/ops/leads/new`, label: "new lead" },
    ];

    for (const target of pages) {
      const response = await page.goto(`${base}${target.path}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1500);
      const facts = await page.evaluate(() => {
        // NO inner function: the esbuild transform wraps an arrow
        // assigned to a const with a `__name` helper that does not
        // exist in the page. The raw facts are collected here and the
        // visibility is decided in Node.
        // NOTE: no arrow function is assigned to a const inside this
        // evaluate. The esbuild transform wraps such an assignment with
        // a `__name` helper that does not exist in the page, and the
        // evaluate dies with "__name is not defined". Every fact is
        // therefore read inline, and the visibility is decided in Node.
        return {
          url: window.location.href,
          heading:
            document.querySelector("h1")?.textContent?.trim() ?? null,
          inputs: Array.from(document.querySelectorAll("input")).map((el) => ({
            name: el.getAttribute("name"),
            type: el.getAttribute("type"),
            label: el.getAttribute("aria-label"),
            rect: el.getBoundingClientRect().toJSON(),
            display: getComputedStyle(el).display,
            visibility: getComputedStyle(el).visibility,
          })),
          buttons: Array.from(document.querySelectorAll("button")).map((el) => ({
            text: (el.textContent ?? "").trim().slice(0, 40),
            rect: el.getBoundingClientRect().toJSON(),
            display: getComputedStyle(el).display,
            visibility: getComputedStyle(el).visibility,
          })),
          selects: Array.from(document.querySelectorAll("select")).map((el) => ({
            name: el.getAttribute("name"),
            label: el.getAttribute("aria-label"),
            rect: el.getBoundingClientRect().toJSON(),
            display: getComputedStyle(el).display,
            visibility: getComputedStyle(el).visibility,
          })),
        };
      });
      const isVisible = (fact: {
        rect: { height: number; width: number };
        display: string;
        visibility: string;
      }) =>
        fact.rect.height > 0 &&
        fact.rect.width > 0 &&
        fact.visibility !== "hidden" &&
        fact.display !== "none";
      console.log(`\n=== ${target.label} (${target.path})`);
      console.log(`  status    : ${response?.status()}`);
      console.log(`  landed on : ${facts.url}`);
      console.log(`  heading   : ${facts.heading}`);
      console.log(
        `  visible inputs : ${JSON.stringify(facts.inputs.filter((i) => isVisible(i)))}`,
      );
      console.log(
        `  hidden inputs  : ${JSON.stringify(facts.inputs.filter((i) => !isVisible(i)).map((i) => ({ name: i.name, type: i.type })))}`,
      );
      console.log(
        `  visible selects: ${JSON.stringify(facts.selects.filter((s) => isVisible(s)))}`,
      );
      console.log(
        `  visible buttons: ${JSON.stringify(facts.buttons.filter((b) => isVisible(b)).map((b) => b.text))}`,
      );
    }
  } finally {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("The diagnostic could not run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
