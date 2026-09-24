import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanProductionCompose } from "@/scripts/lib/dokploy-compose-scan";

const source = readFileSync("docker-compose.production.yml", "utf8");

describe("Production Compose source gate", () => {
  it("accepts the tracked Production Compose", () => {
    expect(scanProductionCompose(source)).toEqual([]);
  });

  it("rejects accidental Dev volume/project reuse", () => {
    expect(scanProductionCompose(source.replaceAll("aqua-pgdata-prod", "aqua-pgdata-dev"))
      .some((failure) => failure.includes("aqua-pgdata-prod"))).toBe(true);
    expect(scanProductionCompose(source.replace("name: aqua-prod\n", "name: aqua-dev\n"))
      .some((failure) => failure.includes("explicit name"))).toBe(true);
  });

  it("refuses a published web port, a mutable image or an always-on backup", () => {
    expect(scanProductionCompose(source.replace('    expose:\n      - "3000"', '    ports:\n      - "3000:3000"'))
      .some((failure) => failure.includes("ports"))).toBe(true);
    expect(scanProductionCompose(source.replaceAll("@${AQUA_IMAGE_DIGEST:?set AQUA_IMAGE_DIGEST}", ":latest"))
      .some((failure) => failure.includes("latest"))).toBe(true);
    expect(scanProductionCompose(source.replace("    profiles: [backup]\n", ""))
      .some((failure) => failure.includes("backup: must be dormant"))).toBe(true);
  });

  it("refuses a privileged database URL on the worker", () => {
    const privileged = source.match(/^      MIGRATION_[A-Z_]+_URL: .+$/m)?.[0];
    expect(privileged).toBeDefined();
    const bad = source.replace(
      /(  worker:[\s\S]*?    environment:\n)/,
      (prefix) => `${prefix}${privileged}\n`,
    );
    expect(scanProductionCompose(bad)).toContain("worker: privileged migration URL is forbidden.");
  });
});
