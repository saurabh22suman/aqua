import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOKPLOY_COMPOSE_FILE,
  scanDokployCompose,
} from "@/scripts/lib/dokploy-compose-scan";

// Deployment PR (feat/deploy-dokploy-compose) positive controls for the
// Dokploy compose scan. CI runs `pnpm check:dokploy-compose`; this file
// proves every rule fails on a known-bad mutation and stays green on
// the real docker-compose.dokploy.yml.

const REAL = join(process.cwd(), DOKPLOY_COMPOSE_FILE);
const TAG = "${AQUA_IMAGE_TAG:?set AQUA_IMAGE_TAG}";
const WORKER_2 = [
  "  worker-2:",
  `    image: ghcr.io/saurabh22suman/aqua:${TAG}`,
  '    command: ["node_modules/.bin/tsx", "worker/index.ts"]',
].join("\n");

function realSource(): string {
  return readFileSync(REAL, "utf8");
}

function violationsFor(mutate: (source: string) => string): string[] {
  return scanDokployCompose(mutate(realSource()));
}

describe("dokploy compose scan", () => {
  it("passes the real docker-compose.dokploy.yml", () => {
    expect(scanDokployCompose(realSource())).toEqual([]);
  });

  it("rejects a host port mapping", () => {
    const violations = violationsFor((source) =>
      source.replace(
        '    expose:\n      - "3000"\n',
        '    ports:\n      - "3000:3000"\n',
      ),
    );
    expect(violations.some((v) => v.includes("ports"))).toBe(true);
  });

  it("rejects a build key", () => {
    const violations = violationsFor((source) =>
      source.replace(
        "    pull_policy: always\n",
        "    pull_policy: always\n    build: .\n",
      ),
    );
    expect(violations.some((v) => v.includes("build"))).toBe(true);
  });

  it("rejects a latest tag or a mutable AQUA_IMAGE_TAG fallback", () => {
    const latest = violationsFor((source) =>
      source.replaceAll(TAG, "latest"),
    );
    expect(latest.some((v) => v.includes("latest") || v.includes("AQUA_IMAGE_TAG"))).toBe(
      true,
    );

    const fallback = violationsFor((source) =>
      source.replaceAll(TAG, "${AQUA_IMAGE_TAG:-latest}"),
    );
    expect(
      fallback.some((v) => v.includes("AQUA_IMAGE_TAG") || v.includes("latest")),
    ).toBe(true);
  });

  it("rejects a second worker", () => {
    const violations = violationsFor((source) =>
      source.replace("\nvolumes:\n", `\n${WORKER_2}\n\nvolumes:\n`),
    );
    expect(violations.some((v) => v.includes("exactly"))).toBe(true);
  });

  it("rejects a migrate service that is not one-shot", () => {
    const violations = violationsFor((source) =>
      source.replace('    restart: "no"\n', "    restart: unless-stopped\n"),
    );
    expect(violations.some((v) => v.includes("one-shot"))).toBe(true);
  });

  it("rejects web/worker without a completed-migration dependency", () => {
    const violations = violationsFor((source) =>
      source.replace(
        "condition: service_completed_successfully",
        "condition: service_started",
      ),
    );
    expect(
      violations.some((v) => v.includes("service_completed_successfully")),
    ).toBe(true);
  });

  it("rejects a database without its persistent named volume", () => {
    const violations = violationsFor((source) =>
      source.replace("      - aqua-pgdata-dev:/var/lib/postgresql/data\n", ""),
    );
    expect(violations.some((v) => v.includes("named volume"))).toBe(true);
  });

  it("rejects a bind-mounted database directory", () => {
    const violations = violationsFor((source) =>
      source.replace(
        "      - aqua-pgdata-dev:/var/lib/postgresql/data\n",
        "      - ../files/pgdata:/var/lib/postgresql/data\n",
      ),
    );
    expect(violations.some((v) => v.includes("bind mount"))).toBe(true);
  });

  it("rejects a service missing from the internal network", () => {
    const violations = violationsFor((source) =>
      source.replace(
        "    networks:\n      - internal\n",
        "    networks:\n      - other\n",
      ),
    );
    expect(violations.some((v) => v.includes("internal network"))).toBe(true);
  });

  it("keeps non-web services off dokploy-network", () => {
    const violations = violationsFor((source) =>
      source.replace(
        "    networks:\n      - internal\n\n  # Run only",
        "    networks:\n      - internal\n      - dokploy-network\n\n  # Run only",
      ),
    );
    expect(violations.some((v) => v.includes("must not join dokploy-network"))).toBe(
      true,
    );
  });

  it("rejects a required secret with a fallback default", () => {
    const violations = violationsFor((source) =>
      source.replace(
        "${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}",
        "${POSTGRES_PASSWORD:-aqua}",
      ),
    );
    expect(violations.some((v) => v.includes("POSTGRES_PASSWORD"))).toBe(true);
  });

  it("keeps backup one-shot, dormant and on the pinned image", () => {
    const unprofiled = violationsFor((source) => source.replace("    profiles: [backup]\n", ""));
    expect(unprofiled.some((v) => v.includes("profiles"))).toBe(true);
    const unpinned = violationsFor((source) => source.replace(
      `  backup:\n    profiles: [backup]\n    image: ghcr.io/saurabh22suman/aqua:${TAG}`,
      "  backup:\n    profiles: [backup]\n    image: postgres:16",
    ));
    expect(unpinned.some((v) => v.includes("backup: image"))).toBe(true);
  });

  it("refuses a missing worker checkpoint key or a fallback R2 secret", () => {
    const missing = violationsFor((source) => source.replace(
      "      AUDIT_CHECKPOINT_SECRET: ${AUDIT_CHECKPOINT_SECRET:?set AUDIT_CHECKPOINT_SECRET}\n", "",
    ));
    expect(missing.some((v) => v.includes("AUDIT_CHECKPOINT_SECRET"))).toBe(true);
    const fallback = violationsFor((source) => source.replaceAll(
      "${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY}", "${R2_SECRET_ACCESS_KEY:-example}",
    ));
    expect(fallback.some((v) => v.includes("R2_SECRET_ACCESS_KEY"))).toBe(true);
  });

  it("refuses a privileged migration URL in Dev web env", () => {
    const source = realSource();
    const privileged = source.match(/^      MIGRATION_[A-Z_]+_URL: .+$/m)?.[0];
    expect(privileged).toBeDefined();
    const bad = source.replace(
      /(  web:[\s\S]*?    environment:\n)/,
      (prefix) => `${prefix}${privileged}\n`,
    );
    expect(scanDokployCompose(bad)).toContain("web: privileged migration URL is forbidden.");
  });
});
