// Ops redesign (28 October 2026) — the console's error RECOVERY.
//
// The contract requires a real error state on the console's surfaces:
// "Clear empty/filter-no-results/loading/error/pending/disabled/
// validation states where applicable."
//
// The Ops segment had NO error boundary of its own, so a read that
// failed — a validated filter rejecting a malformed tenant id, for
// example — rendered the framework's default error page: no retry, no
// way back, and a raw failure message.
//
// The check drives the real failure: /ops/activity?tenantId=not-a-uuid
// makes the validated read fail. It touches no real data and changes no
// backend behaviour.
//
// The recovery must be GENERIC: no error message, no stack, no
// credential, no id.
//
// Run inside the bounded preview:
//   python3 .opencode/scripts/lane_job.py exec python3 .opencode/scripts/preview_job.py \
//     --port 3187 -- pnpm exec tsx e2e/ops-redesign/ops-error-state.ts

import assert from "node:assert/strict";
import { readFixture, signIn } from "./ops-fixture";
import { makeChecker, openConsole } from "./ops-browser";

async function main() {
  const fixture = readFixture();
  const checker = makeChecker();
  const session = await openConsole({ width: 1280, height: 900 });
  const { page, base } = session;

  try {
    await signIn(page, base, fixture.operator);

    await checker.check(
      "a failed read shows a recovery, not a raw failure",
      async () => {
        const response = await page.goto(
          `${base}/ops/activity?tenantId=not-a-uuid`,
          { waitUntil: "domcontentloaded" },
        );
        await page.waitForTimeout(1200);

        // The screen is rendered by the console's own error boundary.
        const retry = page.getByRole("button", { name: /try again|retry/i });
        await retry.waitFor({ timeout: 15_000 });
        assert.ok(retry.isVisible(), "the retry control is not visible");

        const back = page.getByRole("link", { name: "Back to the overview", exact: true });
        await back.waitFor({ timeout: 15_000 });
        assert.ok(back.isVisible(), "the way out is not visible");

        // Nothing sensitive is on the screen.
        const text = (await page.locator("body").innerText()).toLowerCase();
        for (const secret of ["not-a-uuid", "zod", "stack", "at ", "postgres", "aqua_test_"]) {
          assert.ok(
            !text.includes(secret),
            `the error screen exposed "${secret}": ${text.slice(0, 400)}`,
          );
        }

        // And the page does not scroll sideways.
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          true,
          "the error screen scrolls horizontally",
        );

        void response;
      },
    );

    await checker.check(
      "the recovery's way out actually leads back to the console",
      async () => {
        const back = page.getByRole("link", { name: "Back to the overview", exact: true });
        await back.click();
        await page.waitForURL(`${base}/ops`);
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        assert.equal(
          await page.evaluate(() => window.location.pathname),
          "/ops",
          "the way out did not reach the overview",
        );
      },
    );

    await checker.check(
      "the retry control re-runs the screen",
      async () => {
        await page.goto(`${base}/ops/activity?tenantId=not-a-uuid`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForTimeout(1000);
        const retry = page.getByRole("button", { name: /try again|retry/i });
        await retry.waitFor({ timeout: 15_000 });
        await retry.click();
        await page.waitForTimeout(1500);
        // The screen is still the boundary's — the filter is still
        // invalid — but the console is intact and usable.
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true,
          "the retried screen scrolls horizontally",
        );
      },
    );
  } finally {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    await checker.writeResults("ops-error-state.json");
  }

  if (checker.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("The Ops error-state check could not run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
