import { readdirSync } from "node:fs";
import { join } from "node:path";

// M1: fails at PR time, not merge time. Runs before db:reset in CI (see
// .github/workflows/ci.yml) so a naming problem is reported in ~1s
// instead of after a ~2min Postgres bootstrap discovers the same thing
// via db/migrate.ts's own runtime ascending-order guard.
//
// Two eras, both valid:
//   - legacy 0001-0019: hand-numbered, sequential, closed. These were
//     reserved by hand across a batch of 7 PRs written by one agent
//     holding the whole picture in context -- the exact thing that
//     doesn't scale to parallel agents. Never extend this range.
//   - 0020 onward: YYYYMMDDHHmmss timestamps, created via
//     `pnpm db:new-migration <name>` -- collision-free by construction,
//     since two agents creating a migration in the same second is the
//     only way two of these could ever collide, versus certain
//     collision under sequential numbering the moment two agents work
//     in parallel.
const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
const LEGACY_MAX = 19n;

const LEGACY = /^(\d{4})_[a-z0-9_]+\.sql$/;
const TIMESTAMPED = /^(\d{14})_[a-z0-9_]+\.sql$/;

function main(): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const errors: string[] = [];

  for (const f of files) {
    const legacy = f.match(LEGACY);
    const timestamped = f.match(TIMESTAMPED);
    if (legacy) {
      if (BigInt(legacy[1]) > LEGACY_MAX) {
        errors.push(
          `${f}: 4-digit migration numbers are closed at 0019. Use \`pnpm db:new-migration <name>\` for a timestamped filename instead.`,
        );
      }
    } else if (!timestamped) {
      errors.push(
        `${f}: doesn't match NNNN_name.sql (legacy, 0001-0019 only) or YYYYMMDDHHmmss_name.sql. Use \`pnpm db:new-migration <name>\`.`,
      );
    }
  }

  // Same rule db/migrate.ts enforces at runtime, repeated here so a
  // collision (two files with the same or non-ascending numeric
  // prefix) fails fast, before Postgres is even involved.
  for (let i = 1; i < files.length; i++) {
    const prev = files[i - 1].match(/^(\d+)/)?.[1];
    const curr = files[i].match(/^(\d+)/)?.[1];
    if (!prev || !curr || BigInt(curr) <= BigInt(prev)) {
      errors.push(
        `${files[i - 1]} and ${files[i]}: migration numbers must be strictly ascending, got ${prev} then ${curr}. ` +
          `If two branches both created a migration around the same time, regenerate one with \`pnpm db:new-migration\`.`,
      );
    }
  }

  if (errors.length > 0) {
    console.error(`Migration naming check failed (${errors.length} issue(s)):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`Migration naming check passed (${files.length} files).`);
}

main();
