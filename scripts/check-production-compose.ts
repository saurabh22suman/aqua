import { readFileSync } from "node:fs";
import { scanProductionCompose } from "./lib/dokploy-compose-scan";

const path = "docker-compose.production.yml";
const violations = scanProductionCompose(readFileSync(path, "utf8"));
if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exit(1);
}
console.log(`Production Compose check passed (${path}).`);
