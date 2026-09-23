import { readFileSync } from "node:fs";
import {
  DOKPLOY_COMPOSE_FILE,
  scanDokployCompose,
} from "./lib/dokploy-compose-scan";

// Deployment PR (feat/deploy-dokploy-compose) — `pnpm
// check:dokploy-compose [path]`. Parses docker-compose.dokploy.yml (or
// a given path) and fails on the deployment invariants listed in
// scripts/lib/dokploy-compose-scan.ts. Pure source parse, no Docker —
// the `docker compose config` interpolation check is a separate CI
// step that runs with safe dummy values.

const path = process.argv[2] ?? DOKPLOY_COMPOSE_FILE;
const violations = scanDokployCompose(readFileSync(path, "utf8"));

if (violations.length > 0) {
  console.error(`dokploy compose check failed (${path}):`);
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`Dokploy compose check passed (${path}).`);
