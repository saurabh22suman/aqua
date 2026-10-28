// Ops redesign (28 October 2026) — the independent review's four
// changes, as ONE focused browser check.
//
// R2  the new-tenant editor is a single-column form of about 640px
//     (the new-lead form keeps its purposeful two columns at 760px)
// R3  the configuration change request's resolution note has a
//     VISIBLE, ASSOCIATED label — a placeholder is not a label, and
//     the reviewer found the control unnamed to a screen reader
// R5  the activity filter's date and time controls show their FULL
//     value at 1280, at 1024 and on a phone — the root measured them
//     clipped (105.4px per control at 1280, ~70px at 1024, and 146.8px
//     on a 390px phone with the year cut off)
// R6  the leads toolbar puts the Stage picker and the Apply/Clear
//     action on ONE row at the desktop width, instead of a stage
//     picker at the far left and an Apply button alone on a far-right
//     row, with a blank band between them
//
// The check runs BEFORE the fix (the intended RED) and AFTER it (the
// GREEN). It measures the rendered geometry and the accessible names;
// it never reads a class string.
//
//   python3 .opencode/scripts/lane_job.py exec python3 .opencode/scripts/preview_job.py \
//     --port 3187 -- pnpm exec tsx e2e/ops-redesign/ops-review-fixes-check.ts

import assert from "node:assert/strict";
import { readFixture, signIn } from "./ops-fixture";
import { makeChecker, openConsole } from "./ops-browser";

/** The narrowest a native date control may be and still show its value. */
const MIN_DATE_CONTROL_WIDTH = 165;

async function main() {
  const only = process.env.AQUA_OPS_FIXES_ONLY ?? "";
  const fixture = readFixture();
  const checker = makeChecker();
  const session = await openConsole({ width: 1280, height: 900 });
  const { page, base } = session;
  const out =
    process.env.AQUA_E2E_OUT ?? "docs/handoffs/evidence/ops-redesign-20261028";

  const wanted = (id: string) => !only || only.includes(id);

  try {
    await signIn(page, base, fixture.operator);

    // ── R2 ───────────────────────────────────────────────────────────
    if (wanted("R2")) await checker.check(
      "R2: the new-tenant editor is a single column of about 640px",
      async () => {
        await page.goto(`${base}/ops/tenants/new`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForLoadState("load");
        await page.waitForTimeout(600);
        const width = await page.evaluate(() => {
          const input = document.querySelector('input[name="name"]');
          const card = input?.closest("div.rounded-card");
          return card ? card.getBoundingClientRect().width : null;
        });
        assert.ok(width !== null, "the new-tenant card was not rendered");
        assert.ok(
          width! <= 660,
          `the new-tenant card is ${width}px wide — the approved single-column editor is about 640px`,
        );
        await page.screenshot({ path: `${out}/review-fix-new-tenant-1280.png` });
      },
    );

    if (wanted("R2")) await checker.check(
      "R2: the new-lead form keeps its purposeful two columns at 760px",
      async () => {
        await page.goto(`${base}/ops/leads/new`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForLoadState("load");
        await page.waitForTimeout(600);
        const facts = await page.evaluate(() => {
          const input = document.querySelector('input[name="businessName"]');
          const card = input?.closest("div.rounded-card");
          const grid = document.querySelector('input[name="contactName"]')?.parentElement
            ?.parentElement;
          return {
            cardWidth: card ? card.getBoundingClientRect().width : null,
            columns: grid
              ? getComputedStyle(grid).gridTemplateColumns.split(" ").length
              : null,
          };
        });
        assert.ok(facts.cardWidth !== null, "the new-lead card was not rendered");
        assert.ok(
          facts.cardWidth! >= 700 && facts.cardWidth! <= 800,
          `the new-lead card is ${facts.cardWidth}px wide — it should stay at 760px`,
        );
        assert.equal(facts.columns, 2, "the new-lead form lost its two columns");
      },
    );

    // ── R3 ───────────────────────────────────────────────────────────
    if (wanted("R3")) await checker.check(
      "R3: the change request's resolution note has a visible, associated label",
      async () => {
        await page.goto(
          `${base}/ops/tenants/${fixture.tenantId}/configuration`,
          { waitUntil: "domcontentloaded" },
        );
        await page.waitForLoadState("load");
        await page.waitForTimeout(600);
        const note = page.getByLabel("Resolution note (optional)");
        await note.waitFor({ timeout: 15_000 });
        assert.ok(await note.isVisible(), "the resolution note is not visible");
        // The label is a real, visible LABEL element — not only an
        // accessible name.
        const labelled = await note.evaluate((element) => {
          // An ASSOCIATED label is either a wrapping <label> or a
          // <label for=id>; both give the control its accessible
          // name. The wrapping form is the one the shared Field
          // pattern uses.
          const id = element.getAttribute("id");
          const byFor = id
            ? document.querySelector(`label[for="${CSS.escape(id)}"]`)
            : null;
          const label = byFor ?? element.closest("label");
          return {
            hasLabelElement: !!label,
            labelText: label?.textContent?.trim() ?? null,
            labelVisible: label
              ? label.getBoundingClientRect().height > 0
              : false,
          };
        });
        assert.equal(
          labelled.hasLabelElement,
          true,
          "the resolution note has no associated <label>",
        );
        assert.equal(labelled.labelVisible, true, "the label is not visible");
        assert.equal(labelled.labelText, "Resolution note (optional)");
        await page.screenshot({
          path: `${out}/review-fix-configuration-1280.png`,
        });
      },
    );

    // ── R5 ───────────────────────────────────────────────────────────
    for (const viewport of [
      { width: 1280, height: 900, name: "1280" },
      { width: 1024, height: 768, name: "1024" },
      { width: 900, height: 800, name: "900" },
      { width: 768, height: 900, name: "768" },
      { width: 640, height: 900, name: "640" },
      { width: 420, height: 900, name: "420" },
      { width: 390, height: 844, name: "390" },
    ]) {
      await checker.check(
        `R5: the activity date and time controls show their full value at ${viewport.name}`,
        async () => {
          await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          });
          await page.goto(`${base}/ops/activity`, {
            waitUntil: "domcontentloaded",
          });
          await page.waitForLoadState("load");
          await page.waitForTimeout(600);
          const controls = await page.evaluate(() =>
            Array.from(
              document.querySelectorAll<HTMLInputElement>(
                'input[aria-label="Since date (IST)"], input[aria-label="Since time (IST)"], input[aria-label="Until date (IST)"], input[aria-label="Until time (IST)"]',
              ),
            ).map((element) => ({
              label: element.getAttribute("aria-label"),
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
            })),
          );
          assert.equal(
            controls.length,
            4,
            `expected the four date/time controls, found ${controls.length}`,
          );
          for (const control of controls) {
            assert.ok(
              control.clientWidth >= MIN_DATE_CONTROL_WIDTH,
              `${control.label} is ${control.clientWidth}px wide at ${viewport.name} — a native date control needs about ${MIN_DATE_CONTROL_WIDTH}px to show its full value`,
            );
            assert.ok(
              control.scrollWidth <= control.clientWidth + 1,
              `${control.label} is CLIPPED at ${viewport.name} (content ${control.scrollWidth}px in ${control.clientWidth}px)`,
            );
          }
          await page.screenshot({
            path: `${out}/review-fix-activity-${viewport.name}.png`,
          });
        },
      );
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // ── R6 ───────────────────────────────────────────────────────────
    if (wanted("R6")) await checker.check(
      "R6: the leads toolbar puts the Stage picker and the Apply action on one row",
      async () => {
        await page.goto(`${base}/ops/leads`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForLoadState("load");
        await page.waitForTimeout(600);
        const facts = await page.evaluate(() => {
          // Scope from the STAGE PICKER's own form: a bare
          // `form button[type="submit"]` finds the rail's sign-out
          // form, which comes first in the document — and measures the
          // wrong control entirely.
          const stage = document.querySelector('select[name="stage"]');
          const form = stage?.closest("form");
          const apply = form?.querySelector('button[type="submit"]');
          if (!stage || !apply) return null;
          const stageBox = stage.getBoundingClientRect();
          const applyBox = apply.getBoundingClientRect();
          return {
            stageTop: stageBox.top,
            stageBottom: stageBox.bottom,
            applyTop: applyBox.top,
            applyBottom: applyBox.bottom,
            gap: applyBox.left - stageBox.right,
          };
        });
        assert.ok(facts, "the leads toolbar did not render its controls");
        assert.ok(
          Math.abs(facts.applyTop - facts.stageTop) <= 4,
          `the Apply button sits ${Math.round(facts.applyTop - facts.stageTop)}px below the Stage picker — they belong on one row`,
        );
        assert.ok(
          facts.gap >= 0 && facts.gap < 400,
          `there is a ${Math.round(facts.gap)}px blank band between the Stage picker and the Apply button`,
        );
        await page.screenshot({ path: `${out}/review-fix-leads-1280.png` });
      },
    );
  } finally {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    await checker.writeResults("ops-review-fixes-check.json");
  }

  if (checker.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("The Ops review-fixes check could not run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
