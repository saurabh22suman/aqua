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
        '      PARENT_LINK_SECRET: ${PARENT_LINK_SECRET:?set PARENT_LINK_SECRET}\n      NODE_ENV: production\n    depends_on:',
        '      PARENT_LINK_SECRET: ${PARENT_LINK_SECRET:?set PARENT_LINK_SECRET}\n      NODE_ENV: production\n    networks:\n      - internal\n      - dokploy-network\n    depends_on:',
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
});
