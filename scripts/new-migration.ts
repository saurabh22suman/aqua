import { writeFileSync } from "node:fs";
import { join } from "node:path";

// M1: timestamp-based names are collision-free by construction across
// parallel agents/branches, which sequential numbers (0001, 0002, ...)
// are not -- two agents both picking "the next number" off their own
// unmerged branch will pick the same one, and nothing catches it until
// the second PR tries to merge. See docs/agent-lanes.md.
const name = process.argv[2];

if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
  console.error("Usage: pnpm db:new-migration <snake_case_name>");
  console.error("Example: pnpm db:new-migration add_facility_logs");
  process.exit(1);
}

const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHmmss, UTC
const filename = `${ts}_${name}.sql`;
const path = join(process.cwd(), "db", "migrations", filename);

writeFileSync(path, `-- ${name}\n`);
console.log(`Created db/migrations/${filename}`);
