import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_SECRETS,
  scanComposeSecrets,
} from "@/scripts/lib/compose-secrets-scan";

// PR1-C10 positive controls for the compose-secrets scan. The
// production scan runs in CI (pnpm check:compose-secrets); this file
// proves the rule can fail on a known-bad input and stays green on
// the real docker-compose.prod.yml.

const REAL_COMPOSE = join(process.cwd(), "docker-compose.prod.yml");

function goodCompose(): string {
  const lines = [
    "name: aqua-prod",
    "services:",
    "  db:",
    "    image: postgres:16",
    "    restart: unless-stopped",
  ];
  for (const name of REQUIRED_SECRETS) {
    lines.push(`      ${name}: \${${name}:?set ${name}}`);
  }
  return lines.join("\n") + "\n";
}

describe("compose secrets scan", () => {
  it("passes a compose file with required secrets and a db restart policy", () => {
    expect(scanComposeSecrets(goodCompose())).toEqual([]);
  });

  it("flags a fallback default", () => {
    const bad = goodCompose().replace(
      "${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}",
      "${POSTGRES_PASSWORD:-aqua}",
    );
    const violations = scanComposeSecrets(bad);
    expect(violations.some((v) => v.includes("POSTGRES_PASSWORD"))).toBe(true);
    expect(violations.some((v) => v.includes("fallback"))).toBe(true);
  });

  it("flags a missing required secret", () => {
    const bad = goodCompose()
      .split("\n")
      .filter((line) => !line.includes("PARENT_LINK_SECRET"))
      .join("\n");
    expect(
      scanComposeSecrets(bad).some((v) => v.includes("PARENT_LINK_SECRET")),
    ).toBe(true);
  });

  it("flags a db service without restart: unless-stopped", () => {
    const bad = goodCompose().replace("    restart: unless-stopped\n", "");
    expect(scanComposeSecrets(bad).some((v) => v.includes("restart"))).toBe(
      true,
    );
  });

  it("passes the real docker-compose.prod.yml", () => {
    expect(scanComposeSecrets(readFileSync(REAL_COMPOSE, "utf8"))).toEqual([]);
  });
});
