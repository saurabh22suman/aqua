// Ops redesign (28 October 2026) — the focused pre-review check.
//
// Three things the independent review needs proven BEFORE it starts,
// and nothing else:
//
//   1. The POPULATED Overview renders cleanly — no hydration warning,
//      no console error. The populated Overview used to nest a
//      paragraph inside a paragraph, which React reported as a
//      hydration mismatch in every matrix chunk.
//
//   2. The new-tenant form is BOUNDED, with ONE gap between the
//      heading block and the form. The reviewer's preliminary capture
//      suggested a full-width form; this check measures the CURRENT
//      render, scoped to the editor's own form.
//
//   3. The three write screens are read-only for a VIEWER: the
//      create-tenant form, the create-lead form and the WhatsApp mock.
//
// Run inside the bounded preview:
//   python3 .opencode/scripts/lane_job.py exec python3 .opencode/scripts/preview_job.py \
//     --port 3187 -- pnpm exec tsx e2e/ops-redesign/ops-pre-review-check.ts

import assert from "node:assert/strict";
import { readFixture, signIn } from "./ops-fixture";
import { makeChecker, openConsole } from "./ops-browser";

async function main() {
  const fixture = readFixture();
  const checker = makeChecker();
  const session = await openConsole({ width: 1280, height: 900 });
  const { page, base } = session;
  const out =
    process.env.AQUA_E2E_OUT ?? "docs/handoffs/evidence/ops-redesign-20261028";

  const messages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => messages.push(`pageerror: ${String(error)}`));

  try {
    await signIn(page, base, fixture.operator);

    await checker.check(
      "the populated Overview renders with no hydration warning and no console error",
      async () => {
        messages.length = 0;
        await page.goto(`${base}/ops`, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("load");
        await page.waitForTimeout(1500);

        const figures = await page.evaluate(() =>
          Array.from(document.querySelectorAll("main p")).map((p) =>
            (p.textContent ?? "").trim(),
          ),
        );
        const hydrated = await page.evaluate(
          () => document.documentElement.dataset.theme !== undefined,
        );
        assert.ok(hydrated, "the document lost its theme attribute");

        const hydration = messages.filter((message) =>
          /hydrat|did not match|server rendered/i.test(message),
        );
        assert.equal(
          hydration.length,
          0,
          `the browser reported a hydration problem:\n${hydration.join("\n")}`,
        );
        const errors = messages.filter((message) => message.startsWith("error"));
        assert.equal(
          errors.length,
          0,
          `the browser logged errors:\n${errors.join("\n")}`,
        );
        // The four figures are on screen — the populated layout.
        const tiles = await page.evaluate(
          () => document.querySelectorAll("main .rounded-card").length,
        );
        assert.ok(tiles >= 4, `expected the four KPI tiles, found ${tiles}`);
        void figures;
        await page.screenshot({ path: `${out}/pre-review-populated-overview.png` });
      },
    );

    await checker.check(
      "the new-tenant form is bounded to the editor width, with one top gap",
      async () => {
        await page.goto(`${base}/ops/tenants/new`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForLoadState("load");
        await page.waitForTimeout(800);
        const facts = await page.evaluate(() => {
          // Scope from the editor's OWN field: `document.querySelector(
          // "form")` would find the rail's sign-out form, which comes
          // first in the document.
          const input = document.querySelector('input[name="name"]');
          const form = input?.closest("form");
          const card = input?.closest("div.rounded-card");
          // The heading BLOCK, not just the h1: the block's bottom is
          // what the form's gap is measured from.
          const heading = document.querySelector("main h1");
          const headingBlock = heading?.parentElement;
          const headingBox = headingBlock?.getBoundingClientRect();
          const formBox = form?.getBoundingClientRect();
          const cardBox = card?.getBoundingClientRect();
          return {
            formWidth: formBox?.width ?? null,
            cardWidth: cardBox?.width ?? null,
            headingBottom: headingBox?.bottom ?? null,
            formTop: formBox?.top ?? null,
            cardTop: cardBox?.top ?? null,
          };
        });
        assert.ok(facts.formWidth !== null, "the form was not rendered");
        assert.ok(
          facts.formWidth! <= 680,
          `the form is ${facts.formWidth}px wide — the bound editor is about 640px`,
        );
        assert.ok(
          facts.cardWidth !== null && facts.cardWidth! <= 680,
          `the form's card is ${facts.cardWidth}px wide`,
        );
        // ONE top gap between the heading block and the form: the card
        // starts where the heading's block ends, plus a single gap.
        const gap = facts.cardTop! - facts.headingBottom!;
        assert.ok(
          gap > 8 && gap < 80,
          `the gap between the heading and the form is ${gap}px — it should be one comfortable gap`,
        );
        await page.screenshot({ path: `${out}/pre-review-new-tenant.png` });
      },
    );

    await checker.check(
      "a viewer sees no write control on the three write screens",
      async () => {
        // A second, VIEWER operator, signed in on its own.
        const viewerContext = await session.browser.newContext({
          viewport: { width: 1280, height: 900 },
        });
        const viewerPage = await viewerContext.newPage();
        try {
          await signIn(viewerPage, base, fixture.viewer);
          for (const target of [
            { path: "/ops/tenants/new", control: /create tenant/i },
            { path: "/ops/leads/new", control: /save lead/i },
            { path: "/ops/whatsapp", control: /send mock message/i },
          ]) {
            await viewerPage.goto(`${base}${target.path}`, {
              waitUntil: "domcontentloaded",
            });
            await viewerPage.waitForLoadState("load");
            await viewerPage.waitForTimeout(400);
            assert.equal(
              await viewerPage.getByRole("button", { name: target.control }).count(),
              0,
              `${target.path}: a viewer was offered a write control`,
            );
            assert.equal(
              await viewerPage.getByTestId("ops-read-only-note").count(),
              1,
              `${target.path}: the viewer was not told the screen is read-only`,
            );
          }
          await viewerPage.screenshot({
            path: `${out}/pre-review-viewer-tenant-new.png`,
          });
        } finally {
          await viewerContext.close();
        }
      },
    );
  } finally {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    await checker.writeResults("ops-pre-review-check.json");
  }

  if (checker.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("The Ops pre-review check could not run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
