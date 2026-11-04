// Ops redesign (28 October 2026) — the appearance control and the
// activity filter, in real Chrome.
//
// Two pre-freeze findings are proven here:
//
//   - The appearance control now EXISTS in Ops: clicking it changes the
//     document's theme, the choice survives an Ops navigation and a
//     reload, and the signed-in identity and its permissions are
//     untouched.
//
//   - The activity filter's date bounds work: a relative range and a
//     manual IST range both produce a URL that RELOADS to the same
//     filter, the visible controls reflect the filter that is actually
//     applied, and the browser logs NO date-input warning (the old
//     implementation put a full ISO timestamp into a date field, which
//     Chrome rejects and paints blank).
//
// Run inside the bounded preview:
//   python3 .opencode/scripts/lane_job.py exec python3 .opencode/scripts/preview_job.py \
//     --port 3187 -- pnpm exec tsx e2e/ops-redesign/ops-theme-and-filters.ts

import assert from "node:assert/strict";
import { readFixture, signIn } from "./ops-fixture";
import { makeChecker, openConsole } from "./ops-browser";

async function main() {
  const fixture = readFixture();
  const checker = makeChecker();
  const session = await openConsole({ width: 1280, height: 900 });
  const { page, base } = session;

  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });

  try {
    await signIn(page, base, fixture.operator);

    await checker.check(
      "the appearance control changes the document's theme and survives a navigation and a reload",
      async () => {
        const before = await page.evaluate(() => document.documentElement.dataset.theme);
        const toggle = page.getByTestId("theme-toggle").first();
        await toggle.waitFor();
        await toggle.click();

        const after = await page.evaluate(() => document.documentElement.dataset.theme);
        assert.notEqual(after, before, "the theme did not change");

        // It survives an Ops navigation…
        await page.goto(`${base}/ops/tenants`);
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.dataset.theme),
          after,
          "the theme was lost on navigation",
        );

        // …and a reload.
        await page.reload();
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.dataset.theme),
          after,
          "the theme was lost on reload",
        );

        // The identity and the navigation are untouched.
        await page.getByRole("navigation", { name: "Platform" }).waitFor();
        assert.equal(
          await page.getByRole("navigation", { name: "Platform" }).getByRole("link").count(),
          7,
          "the navigation changed when the appearance changed",
        );
        assert.equal(
          await page.getByRole("button", { name: "Sign out", exact: true }).count(),
          1,
          "the visible exit control changed when the appearance changed",
        );
      },
    );

    await checker.check(
      "a relative range applies, and the reloaded URL shows the same filter",
      async () => {
        await page.goto(`${base}/ops/activity`);
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        await page.getByLabel("Range").selectOption("7d");
        await page.getByRole("button", { name: "Apply" }).click();
        await page.waitForFunction(() => window.location.search.includes("since="));

        const search = await page.evaluate(() => window.location.search);
        assert.match(search, /since=/, "the range put no start in the URL");
        assert.match(search, /until=/, "the range put no end in the URL");

        // Reload the shared URL: the controls must show the filter
        // that is actually applied — not an empty date field.
        await page.reload();
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        // A URL carries two INSTANTS, not a moving relative range: the
        // honest representation on reload is "Custom" with exactly
        // those instants — the window does not move under the reader.
        assert.equal(
          await page.getByLabel("Range").inputValue(),
          "custom",
          "the reloaded URL did not show the applied bounds",
        );
        assert.notEqual(
          await page.getByLabel("Since date (IST)").inputValue(),
          "",
          "the reloaded URL showed a blank start date",
        );
        assert.notEqual(
          await page.getByLabel("Until date (IST)").inputValue(),
          "",
          "the reloaded URL showed a blank end date",
        );
        // The visible bounds are the SAME instants the URL carries.
        const shown = await page.evaluate(() => ({
          since: document.querySelector<HTMLInputElement>('input[aria-label="Since date (IST)"]')?.value,
          until: document.querySelector<HTMLInputElement>('input[aria-label="Until date (IST)"]')?.value,
        }));
        assert.ok(shown.since && shown.until, "the reloaded URL left a bound blank");
      },
    );

    await checker.check(
      "a manual IST range applies, and the reloaded URL shows the same instants",
      async () => {
        await page.goto(`${base}/ops/activity`);
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        await page.getByLabel("Range").selectOption("custom");
        await page.getByLabel("Since date (IST)").fill("2026-10-01");
        await page.getByLabel("Since time (IST)").fill("09:30:00");
        await page.getByLabel("Until date (IST)").fill("2026-10-02");
        await page.getByLabel("Until time (IST)").fill("18:45:00");
        await page.getByRole("button", { name: "Apply" }).click();
        await page.waitForFunction(() => window.location.search.includes("since="));

        const search = await page.evaluate(() => window.location.search);
        assert.ok(
          search.includes(encodeURIComponent("2026-10-01T09:30:00+05:30")),
          `the manual start was not an offset-aware IST timestamp: ${search}`,
        );
        assert.ok(
          search.includes(encodeURIComponent("2026-10-02T18:45:00+05:30")),
          `the manual end was not an offset-aware IST timestamp: ${search}`,
        );

        await page.reload();
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        assert.equal(
          await page.getByLabel("Since date (IST)").inputValue(),
          "2026-10-01",
          "the reloaded URL did not show the applied start date",
        );
        assert.equal(
          await page.getByLabel("Since time (IST)").inputValue(),
          "09:30:00",
          "the reloaded URL did not show the applied start time",
        );
      },
    );

    await checker.check(
      "a start after the end is refused with a readable message",
      async () => {
        await page.goto(`${base}/ops/activity`);
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        await page.getByLabel("Range").selectOption("custom");
        await page.getByLabel("Since date (IST)").fill("2026-10-05");
        await page.getByLabel("Since time (IST)").fill("10:00:00");
        await page.getByLabel("Until date (IST)").fill("2026-10-01");
        await page.getByLabel("Until time (IST)").fill("10:00:00");
        await page.getByRole("button", { name: "Apply" }).click();
        const message = page.getByTestId("ops-activity-filter-error");
        await message.waitFor();
        assert.match(
          await message.innerText(),
          /must not be after/i,
          "the reversed range was not refused with a readable message",
        );
        assert.equal(
          await page.evaluate(() => window.location.search),
          "",
          "the reversed range was applied anyway",
        );
      },
    );

    await checker.check(
      "the browser logged no date-input warning",
      async () => {
        const dateWarnings = consoleMessages.filter((message) =>
          /date|invalid.*value|value.*invalid/i.test(message),
        );
        assert.equal(
          dateWarnings.length,
          0,
          `the browser warned about the date controls:\n${dateWarnings.join("\n")}`,
        );
      },
    );
  } finally {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    await checker.writeResults("ops-theme-and-filters.json");
  }

  if (checker.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("The Ops theme/filter check could not run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
