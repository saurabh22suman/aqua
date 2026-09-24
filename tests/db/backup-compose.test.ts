import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/backup-compose.sh");

function invoke(health: string, composeName = "docker-compose.dokploy.yml") {
  const dir = mkdtempSync(join(tmpdir(), "aqua-backup-command-"));
  const file = join(dir, composeName);
  const log = join(dir, "docker-calls.txt");
  writeFileSync(file, "services: {}\n");
  writeFileSync(join(dir, ".env"), "AQUA_IMAGE_TAG=sha-000000000000\n");
  writeFileSync(join(dir, "docker"), `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
case "$*" in
  *' ps -q db') printf '%s\\n' 'db-container-id' ;;
  'inspect '* ) printf '%s\\n' "$FAKE_DB_HEALTH" ;;
esac
`);
  chmodSync(join(dir, "docker"), 0o755);
  try {
    const result = spawnSync("/bin/sh", [SCRIPT, file], {
      encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_LOG: log, FAKE_DB_HEALTH: health },
    });
    return { code: result.status, stderr: result.stderr, calls: readFileSync(log, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("tracked Compose backup operator entry point", () => {
  it("executes exactly the explicit backup profile against a healthy Dev DB", () => {
    const result = invoke("healthy");
    expect(result.code).toBe(0);
    expect(result.calls).toContain("--profile backup config --quiet");
    expect(result.calls).toContain("--profile backup run --rm --no-deps backup");
    expect(result.calls).not.toContain("up -d");
  });

  it("fails closed if the DB is unhealthy without starting or backing it up", () => {
    const result = invoke("unhealthy", "docker-compose.production.yml");
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/not healthy/);
    expect(result.calls).not.toContain("run --rm");
    expect(result.calls).not.toContain("up -d");
  });
});
