import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// DESIGN.md §1.3: 60 KB, latin subset only, woff2 (the format every
// current browser actually fetches — .woff ships alongside it as a
// fallback in the same @font-face rule but is never downloaded when
// woff2 is supported, so it's excluded here; counting it would report a
// number no real user pays). Self-contained like
// scripts/check-bundle-budget.ts: runs its own build so this is correct
// standalone, not dependent on CI step ordering.
const BUDGET_BYTES = 60 * 1024;
const MEDIA_DIR = join(process.cwd(), ".next", "static", "media");

function runBuild(): void {
  try {
    execFileSync("pnpm", ["exec", "next", "build"], {
      stdio: "inherit",
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
  } catch {
    throw new Error("next build failed — see output above");
  }
}

function main(): void {
  runBuild();

  const files = readdirSync(MEDIA_DIR).filter((f) => f.endsWith(".woff2"));
  if (files.length === 0) {
    throw new Error(
      `No .woff2 files found in ${MEDIA_DIR} — did the font imports change? Update this script if the build output layout changed.`,
    );
  }

  console.log(
    `\nFont budget: ${(BUDGET_BYTES / 1024).toFixed(0)} kB, latin subset only, woff2\n`,
  );

  let total = 0;
  for (const f of files.sort()) {
    const bytes = statSync(join(MEDIA_DIR, f)).size;
    total += bytes;
    console.log(`  ${f.padEnd(50)} ${(bytes / 1024).toFixed(1).padStart(7)} kB`);
  }
  console.log(`  ${"TOTAL".padEnd(50)} ${(total / 1024).toFixed(1).padStart(7)} kB`);

  if (total > BUDGET_BYTES) {
    console.error(
      `\nFont total ${(total / 1024).toFixed(1)} kB exceeds the ${(BUDGET_BYTES / 1024).toFixed(0)} kB budget (${files.length} files).`,
    );
    process.exit(1);
  }
  console.log(`\nWithin budget (${files.length} files).`);
}

main();
