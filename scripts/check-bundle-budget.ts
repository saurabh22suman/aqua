import { execFileSync } from "node:child_process";

// DESIGN.md §5: "First-load JS, gzipped: 150 KB — build fails above." No
// bundlesize/size-limit dependency: `next build`'s own summary table is
// already the authoritative, gzip-accurate number (verified against a
// manual gzip of the app-build-manifest's file list — that undercounts,
// since it omits ancestor layout chunks the browser also fetches; Next's
// own table is the one DESIGN.md's number is meant to track). This parses
// that table instead of recomputing it.
const BUDGET_BYTES = 150 * 1024;

const ROW_RE = /^\S+\s+\S\s+(\/\S*)\s+([\d.]+\s*(?:kB|B))\s+([\d.]+\s*(?:kB|B))\s*$/u;

function toBytes(sizeText: string): number {
  const match = sizeText.match(/^([\d.]+)\s*(kB|B)$/);
  if (!match) throw new Error(`Unparseable size: "${sizeText}"`);
  const value = Number(match[1]);
  return match[2] === "kB" ? Math.round(value * 1024) : value;
}

function runBuild(): string {
  try {
    return execFileSync("pnpm", ["exec", "next", "build"], {
      encoding: "utf8",
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    console.error(e.stdout ?? "");
    console.error(e.stderr ?? "");
    throw new Error("next build failed — see output above");
  }
}

function main(): void {
  const output = runBuild();
  const rows: { route: string; firstLoadBytes: number; firstLoadText: string }[] = [];

  for (const line of output.split("\n")) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    const [, route, , firstLoadText] = m;
    rows.push({ route, firstLoadText, firstLoadBytes: toBytes(firstLoadText) });
  }

  if (rows.length === 0) {
    throw new Error(
      "Parsed zero routes from `next build` output — the table format changed; update ROW_RE in scripts/check-bundle-budget.ts",
    );
  }

  console.log(`\nFirst Load JS budget: ${(BUDGET_BYTES / 1024).toFixed(0)} kB gzipped, per route\n`);
  const over: typeof rows = [];
  for (const r of rows.sort((a, b) => b.firstLoadBytes - a.firstLoadBytes)) {
    const flag = r.firstLoadBytes > BUDGET_BYTES ? " OVER BUDGET" : "";
    console.log(`  ${r.route.padEnd(32)} ${r.firstLoadText.padStart(8)}${flag}`);
    if (r.firstLoadBytes > BUDGET_BYTES) over.push(r);
  }

  if (over.length > 0) {
    console.error(
      `\n${over.length} route(s) exceed the ${(BUDGET_BYTES / 1024).toFixed(0)} kB first-load budget.`,
    );
    process.exit(1);
  }
  console.log(`\nAll ${rows.length} routes within budget.`);
}

main();
