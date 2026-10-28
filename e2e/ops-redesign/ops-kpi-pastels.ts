// Ops redesign (28 October 2026) — the Ops summary tiles' PASTEL
// language.
//
// The approved direction (DESIGN.md §1.4b): the console's summary
// tiles carry the same subtle pastel language as the Owner's, using the
// tokens that already exist:
//
//   Active tenants → tile-money   (a calm mint surface)
//   On trial       → tile-butter
//   At risk        → late-soft    (ONLY when the count is positive)
//   Open ops tasks → tile-info    (blue in Mint, lavender in Lavender)
//
// The tiles are all white at the moment. This check measures the
// RENDERED background of each tile in BOTH light presets and compares
// it with the resolved token value — a real measurement in a real
// browser, not a class-string assertion.
//
// THE RISK COUNT IS DRIVEN EXPLICITLY. The check writes the snapshot
// row it reads (the platform's own daily snapshot), first with a
// POSITIVE risk count and then with ZERO, and restores the row's
// original values in the finally. Neither case is left to whatever the
// fixture happens to contain, and neither assertion can silently skip.
//
// The colours never carry the meaning on their own: the label and the
// number are the authoritative text, and a ZERO risk count must stay
// calm (no red alarm) and say so in words.
//
// Run inside the bounded preview:
//   python3 .opencode/scripts/lane_job.py exec python3 .opencode/scripts/preview_job.py \
//     --port 3187 -- pnpm exec tsx e2e/ops-redesign/ops-kpi-pastels.ts

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  markTotpEnrolled,
  provisionPlatformUser,
} from "@/db/platform-auth";
import { privilegedFixturePool } from "../../tests/db/privileged-fixture";
import { signIn } from "./ops-fixture";
import { makeChecker, openConsole } from "./ops-browser";

/** The tile each figure belongs on, and the token it should wear. */
const EXPECTED = [
  { label: "Active tenants", token: "--color-tile-money" },
  { label: "On trial", token: "--color-tile-butter" },
  { label: "At risk", token: "--color-late-soft" },
  { label: "Open ops tasks", token: "--color-tile-info" },
];

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

type SnapshotRow = {
  on_date: string;
  active_tenants: number;
  trial_tenants: number;
  at_risk_tenants: number;
  open_ops_tasks: number;
};

async function readSnapshot(): Promise<SnapshotRow | null> {
  const result = await privilegedFixturePool.query(
    "select on_date, active_tenants, trial_tenants, at_risk_tenants, open_ops_tasks from platform_metrics_daily order by on_date desc limit 1",
  );
  return (result.rows[0] as SnapshotRow | undefined) ?? null;
}

async function writeRiskCount(count: number): Promise<void> {
  await privilegedFixturePool.query(
    "update platform_metrics_daily set at_risk_tenants = $1 where on_date = (select on_date from platform_metrics_daily order by on_date desc limit 1)",
    [count],
  );
}

async function restoreSnapshot(row: SnapshotRow | null): Promise<void> {
  if (!row) return;
  await privilegedFixturePool.query(
    "update platform_metrics_daily set active_tenants = $1, trial_tenants = $2, at_risk_tenants = $3, open_ops_tasks = $4 where on_date = $5",
    [
      row.active_tenants,
      row.trial_tenants,
      row.at_risk_tenants,
      row.open_ops_tasks,
      row.on_date,
    ],
  );
}

async function main() {
  const checker = makeChecker();
  const session = await openConsole({ width: 1280, height: 900 });
  const { page, base } = session;
  let operatorId = "";
  let original: SnapshotRow | null = null;

  try {
    // A DISPOSABLE operator for this rendering check. The fixture's
    // operator may be inside the platform's own sign-in rate limit
    // (five failures per account, twenty per address, in fifteen
    // minutes) — that limiter is a security control, not something to
    // work around by reusing a locked account, and this check is about
    // PAINT, not about the fixture's identity. The operator is deleted
    // in the finally; nothing secret is printed.
    const email = `kpi-pastel-${randomUUID()}@example.test`;
    const password = `Synthetic-${randomUUID()}`;
    const created = await provisionPlatformUser({
      email,
      password,
      name: "KPI pastel check",
      role: "admin",
    });
    await markTotpEnrolled(created.id);
    operatorId = created.id;
    await signIn(page, base, {
      id: created.id,
      email,
      password,
      totpSecret: created.totpSecret,
      role: "admin",
    });

    original = await readSnapshot();
    assert.ok(original, "the disposable database has no platform metrics snapshot");

    for (const theme of ["mint", "lavender"] as const) {
      await page.context().addCookies([
        { name: "aqua_theme", value: theme, url: base },
      ]);

      // ── The POSITIVE risk case, driven explicitly ────────────────
      await writeRiskCount(4);
      await page.goto(`${base}/ops`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load");
      await page.waitForTimeout(700);

      await checker.check(
        `${theme}: every summary tile wears its assigned pastel surface (a positive risk count)`,
        async () => {
          const facts = await measureTiles(page, EXPECTED.map((e) => e.label));
          for (const entry of EXPECTED) {
            const tile = facts.tiles.find((t) => t.label === entry.label);
            assert.ok(tile, `the ${entry.label} tile was not rendered`);
            const expected = facts.tokens[entry.token];
            assert.ok(expected, `the ${entry.token} token did not resolve`);
            assert.equal(
              toRgbTriplet(tile.background ?? ""),
              toRgbTriplet(expected),
              `the ${entry.label} tile paints ${tile.background}; ${entry.token} resolves to ${expected}`,
            );
            assert.ok(tile.chip, `the ${entry.label} tile has no 32px icon chip`);
            assert.equal(tile.chip.size, 32);
            assert.equal(tile.chip.radius, "10px");
          }
          // A positive risk count wears the late ink on the FIGURE.
          const risk = facts.tiles.find((t) => t.label === "At risk");
          assert.equal(risk?.valueColor, "rgb(178, 51, 43)", "the at-risk figure is not in the late ink");
          assert.match(risk?.text ?? "", /4/, "the at-risk tile does not show the driven count");
        },
      );

      // ── The ZERO risk case, driven explicitly ─────────────────────
      await writeRiskCount(0);
      await page.goto(`${base}/ops`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load");
      await page.waitForTimeout(700);

      await checker.check(
        `${theme}: a zero risk count stays calm and says so in words`,
        async () => {
          const facts = await measureTiles(page, ["At risk"]);
          const risk = facts.tiles.find((t) => t.label === "At risk");
          assert.ok(risk, "the at-risk tile was not rendered");
          assert.equal(risk.text.includes("4"), false, "the driven zero count was not applied");
          assert.match(
            risk.text,
            /no tenant is at risk/i,
            "a zero risk count does not say that there is no risk",
          );
          assert.notEqual(
            toRgbTriplet(risk.background ?? ""),
            toRgbTriplet("rgb(252, 233, 231)"),
            `a zero risk count is painted as an alarm (${risk.background})`,
          );
          assert.notEqual(
            toRgbTriplet(risk.valueColor ?? ""),
            toRgbTriplet("rgb(178, 51, 43)"),
            "a zero risk count wears the late ink",
          );
        },
      );
    }

    // ── The narrow screen ────────────────────────────────────────────
    await writeRiskCount(4);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/ops`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await page.waitForTimeout(700);
    await checker.check(
      "the summary tiles still read on a phone, with no sideways scroll",
      async () => {
        const facts = await measureTiles(page, EXPECTED.map((e) => e.label));
        assert.equal(facts.tiles.length, 4, "the four tiles are not all rendered");
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        assert.equal(overflow, false, "the Overview scrolls sideways on a phone");
        for (const tile of facts.tiles) {
          assert.ok(
            (tile.chip?.size ?? 0) === 32,
            `the ${tile.label} chip is ${tile.chip?.size}px on a phone`,
          );
        }
      },
    );
  } finally {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    await checker.writeResults("ops-kpi-pastels.json");
    // The snapshot row goes back to exactly what it was.
    await restoreSnapshot(original).catch(() => undefined);
    // The disposable operator leaves no trace.
    if (operatorId) {
      await privilegedFixturePool
        .query("delete from platform_users where id = $1", [operatorId])
        .catch(() => undefined);
    }
    await privilegedFixturePool.end().catch(() => undefined);
  }

  if (checker.failed) process.exitCode = 1;
}

/**
 * Measure the rendered tiles.
 *
 * The tile is the nearest ANCESTOR of its label that paints a
 * background — which is true whether the label sits directly in the
 * tile or inside a header row with an icon chip. The chip is the tile's
 * own 32px child.
 */
async function measureTiles(
  page: import("playwright").Page,
  labels: string[],
): Promise<{
  tokens: Record<string, string>;
  tiles: Array<{
    label: string;
    background: string | null;
    valueColor: string | null;
    text: string;
    chip: { size: number; radius: string; background: string } | null;
  }>;
}> {
  return await page.evaluate(
    (wanted) => {
      const probe = document.createElement("div");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      document.body.appendChild(probe);
      const tokens: Record<string, string> = {};
      for (const name of [
        "--color-tile-money",
        "--color-tile-butter",
        "--color-tile-info",
        "--color-late-soft",
        "--color-paper",
        "--color-late",
      ]) {
        probe.style.backgroundColor = `var(${name})`;
        tokens[name] = getComputedStyle(probe).backgroundColor;
      }
      probe.remove();

      const tiles = wanted.map((label) => {
        const labelElement = Array.from(document.querySelectorAll("main p")).find(
          (p) => (p.textContent ?? "").trim() === label,
        );
        let tile = (labelElement as HTMLElement | undefined) ?? null;
        while (tile && tile !== document.body) {
          const background = getComputedStyle(tile).backgroundColor;
          if (
            background !== "rgba(0, 0, 0, 0)" &&
            background !== "transparent"
          ) {
            break;
          }
          tile = tile.parentElement;
        }
        const value = tile
          ? Array.from(tile.querySelectorAll("p")).find(
              (p) => !(p.textContent ?? "").trim().startsWith(label),
            )
          : null;
        const chip = tile
          ? Array.from(tile.querySelectorAll("span")).find((span) => {
              const box = span.getBoundingClientRect();
              return box.width === 32 && box.height === 32;
            })
          : null;
        return {
          label,
          background: tile ? getComputedStyle(tile).backgroundColor : null,
          valueColor: value ? getComputedStyle(value).color : null,
          text: tile?.textContent ?? "",
          chip: chip
            ? {
                size: Math.round(chip.getBoundingClientRect().width),
                radius: getComputedStyle(chip).borderTopLeftRadius,
                background: getComputedStyle(chip).backgroundColor,
              }
            : null,
        };
      });
      return { tokens, tiles };
    },
    labels,
  );
}

main().catch((error) => {
  console.error("The Ops KPI pastel check could not run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
