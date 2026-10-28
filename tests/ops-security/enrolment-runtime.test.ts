// @vitest-environment node
//
// Ops redesign / Ops security (28 October 2026) — the enrolment CLI in
// the RUNTIME IMAGE.
//
// The staging operator needs the approved authenticator-enrolment CLI,
// and the human confirmed it. The Dockerfile's runtime stage copies the
// backup CLI and its helper, but NOT the enrolment CLI — so a deployed
// image cannot enrol an operator's authenticator at all.
//
// The enrolment CLI is a TRUSTED-TERMINAL tool: it never changes a
// password or a role, it prints a provisioning key only to an
// interactive terminal, and it reads the confirmation code from stdin
// rather than from the command line.
//
// This file is the PACKAGING acceptance for that tool:
//
//   - the runtime stage must CARRY it (inclusion);
//   - the runtime stage must NOT carry the seed/reset utilities (the
//     boundary the Dockerfile already draws);
//   - the CLI's own imports must all be modules the runtime image
//     carries, so the copy is sufficient to RUN it.
//
// It reads the Dockerfile and the CLI's source; it never imports the
// CLI, so a packaging regression fails here as a packaging fact rather
// than as an import error.
//
// It lives beside the other Ops-security checks, because that is where
// the enrolment CLI's own behaviour is proven
// (tests/ops-security/enrolment.test.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DOCKERFILE = readFileSync(join(ROOT, "Dockerfile"), "utf8");
const CLI_PATH = "scripts/enrol-ops-authenticator.ts";
const CLI_SOURCE = readFileSync(join(ROOT, CLI_PATH), "utf8");

/** The runtime stage's own text — the stage after the last FROM. */
function runtimeStage(): string {
  const stages = [...DOCKERFILE.matchAll(/^FROM\s+(.+)$/gm)];
  const last = stages[stages.length - 1];
  if (!last) throw new Error("the Dockerfile declares no stage");
  const start = (last.index ?? 0) + last[0].length;
  return DOCKERFILE.slice(start);
}

/** The COPY lines of the runtime stage. */
function runtimeCopies(): string[] {
  return runtimeStage()
    .split("\n")
    .filter((line) => /^COPY\s/i.test(line.trim()))
    .map((line) => line.trim());
}

/** The source paths a COPY line brings into the image. */
function copiedPaths(): string[] {
  return runtimeCopies().flatMap((line) => {
    const parts = line.split(/\s+/);
    // COPY --from=<stage> <src> <dest>
    const sources = parts.slice(1, -1).filter((part) => !part.startsWith("--"));
    return sources.map((source) => source.replace(/^\/app\//, ""));
  });
}

/** Does the image carry this module? A copied DIRECTORY carries it. */
function imageCarries(copied: readonly string[], module: string): boolean {
  return copied.some(
    (path) => path === module || module.startsWith(`${path}/`),
  );
}

describe("The runtime image carries the Ops enrolment CLI", () => {
  it("copies the enrolment CLI into the runtime stage", () => {
    expect(
      copiedPaths(),
      `the runtime stage does not copy ${CLI_PATH}; the staging operator cannot enrol an authenticator in the deployed image`,
    ).toContain(CLI_PATH);
  });

  it("copies it as a single file, not the whole scripts directory", () => {
    const copies = runtimeCopies().filter((line) => line.includes(CLI_PATH));
    expect(copies).toHaveLength(1);
    // The destination keeps the scripts/ directory, so the CLI's
    // relative imports still resolve.
    expect(copies[0]).toContain("./scripts/enrol-ops-authenticator.ts");
  });

  it("keeps the seed and reset utilities OUT of the runtime image", () => {
    const copied = copiedPaths();
    for (const forbidden of [
      "scripts/seed.ts",
      "scripts/seed-platform.ts",
      "scripts/seed-demo.ts",
      "db/reset.ts",
      "db/deploy.ts",
      "db/migrate.ts",
    ]) {
      expect(copied, `${forbidden} must not be in the runtime image`).not.toContain(
        forbidden,
      );
    }
    // The scripts/ directory as a whole is never copied.
    expect(copied).not.toContain("scripts");
  });

  it("carries every module the CLI imports, so the copy is enough to run it", () => {
    const copied = copiedPaths();
    const imports = [...CLI_SOURCE.matchAll(/from\s+"(\.[^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      const target = specifier.replace(/^\.\.\//, "").replace(/\.ts$/, "");
      expect(
        imageCarries(copied, target),
        `the CLI imports ${specifier}, but ${target} is not in the runtime image`,
      ).toBe(true);
    }
  });

  it("keeps the CLI's own guards: no unattended key output, no code in the arguments", () => {
    // A provisioning URI is a credential: the preparation step refuses
    // a non-interactive stdout, so a key can never be piped into a log.
    expect(CLI_SOURCE).toContain("process.stdout.isTTY");
    // The confirmation code is read from stdin, never from argv.
    expect(CLI_SOURCE).toContain("process.stdin.isTTY");
    // The CLI changes no password and no role.
    expect(CLI_SOURCE).not.toMatch(/password_hash\s*[:=]/);
    expect(CLI_SOURCE).not.toMatch(/passwordSalt\s*[:=]/);
  });
});
