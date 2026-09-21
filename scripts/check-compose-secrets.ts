import { readFileSync } from "node:fs";
import { scanComposeSecrets } from "./lib/compose-secrets-scan";

// PR1-C10 — `pnpm check:compose-secrets [path]`. Fails when a required
// secret has a fallback default, is missing entirely, or the db
// service lost its restart policy. Pure source parse, no Docker.

const path = process.argv[2] ?? "docker-compose.prod.yml";
const violations = scanComposeSecrets(readFileSync(path, "utf8"));

if (violations.length > 0) {
  console.error(`compose secrets check failed (${path}):`);
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`Compose secrets check passed (${path}).`);
