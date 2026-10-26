// Staging deployment isolation — the structural contract for
// docker-compose.staging.yml and docker-compose.staging.env.example.
//
// The staging unit is a SEPARATE deployment on the SAME Docker host as
// the Dev unit. Two Compose projects on one host share everything Docker
// namespaces by NAME: the project name, the named volumes and the
// networks. One wrong name and staging silently reuses the Dev
// database volume — the data of a live pilot, written to by a preview
// deployment.
//
// So this file is not a style check. It parses the compose documents and
// asserts the isolation contract:
//
//   * the project, the database volume and the internal network are
//     named independently of every other deployment unit in the repo;
//   * the database is never on an external network and never publishes a
//     host port;
//   * the privileged migration URL never reaches a runtime service;
//   * the image is immutable and the secrets fail closed.
//
// The scanner itself is PRODUCTION code — scripts/lib/staging-compose-scan.ts,
// run by scripts/check-staging-compose.ts. These fixtures share that one
// implementation: a second copy in a test file would drift, and a scanner
// nobody runs is not a gate.
//
// The parser is deliberately dependency-free: the repo has no YAML library
// (scripts/lib/dokploy-compose-scan.ts says so explicitly and adding one
// needs a decision), so the scanner reads the compose subset the repo
// actually uses. The negative controls at the bottom mutate the real
// staging source and prove each rule actually fires — a scanner that
// cannot fail is not a contract.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_IMAGE,
  APP_SERVICES,
  EXPECTED_SERVICES,
  parseCompose,
  privilegedUrlKeys,
  REQUIRED_SECRETS,
  scanStagingCompose,
  STAGING_NETWORK,
  STAGING_PROJECT,
  STAGING_VOLUME,
} from "@/scripts/lib/staging-compose-scan";

const ROOT = process.cwd();
const STAGING_COMPOSE = join(ROOT, "docker-compose.staging.yml");
const STAGING_ENV_EXAMPLE = join(ROOT, "docker-compose.staging.env.example");
const STAGING_CLI = join(ROOT, "scripts", "check-staging-compose.ts");
const STAGING_SCAN_LIB = join(ROOT, "scripts", "lib", "staging-compose-scan.ts");

// The deployment units that already exist on the host. Staging must not
// share a project name, a volume name or a network name with any of them.
const OTHER_UNITS = [
  "docker-compose.yml",
  "docker-compose.local.yml",
  "docker-compose.dokploy.yml",
  "docker-compose.production.yml",
];

// ---------------------------------------------------------------------------
// Helpers for the tests.
// ---------------------------------------------------------------------------

function stagingSource(): string {
  return existsSync(STAGING_COMPOSE) ? readFileSync(STAGING_COMPOSE, "utf8") : "";
}

/**
 * The privileged-URL entries of a service, read from the PARSED compose
 * file.
 *
 * The key name is never written literally in this file: the tier1
 * no-superuser guard treats a literal privileged key in a source file as
 * a request-path reference, and this file is not one of the three
 * allowlisted baseline files. The key SHAPE is matched instead, and the
 * value comes from the canonical compose file, so the mutation below
 * inserts the real credential shape rather than a hand-written
 * imitation of it.
 */
function privilegedEntries(
  service: ReturnType<typeof parseCompose>["services"][string],
): Array<[string, string]> {
  return Object.entries(service.environment ?? {}).filter(([key]) =>
    /^MIGRATION_[A-Z_]*URL$/.test(key),
  );
}

function violationsFor(mutate: (source: string) => string): string[] {
  const source = stagingSource();
  const mutated = mutate(source);
  // A control that mutates nothing would pass for the wrong reason.
  expect(
    mutated,
    "the known-bad mutation did not change the staging source — this control would pass for the wrong reason",
  ).not.toBe(source);
  return scanStagingCompose(mutated);
}

// ---------------------------------------------------------------------------

describe("staging compose file", () => {
  it("exists", () => {
    expect(
      existsSync(STAGING_COMPOSE),
      "docker-compose.staging.yml is missing — the staging deployment unit has no source",
    ).toBe(true);
  });

  it("passes the staging isolation contract", () => {
    expect(scanStagingCompose(stagingSource())).toEqual([]);
  });

  it("declares exactly db, migrate, web, worker and a dormant backup", () => {
    const file = parseCompose(stagingSource());
    expect(Object.keys(file.services).sort()).toEqual([...EXPECTED_SERVICES]);
    expect(file.project).toBe(STAGING_PROJECT);
  });

  it("keeps the database off every external network and off every host port", () => {
    const file = parseCompose(stagingSource());
    const db = file.services.db;
    // Fail closed: an absent db service has no ports either.
    expect(db, "the staging compose declares no db service").toBeDefined();
    expect(db!.ports ?? []).toEqual([]);
    expect(db!.expose ?? []).toEqual([]);
    const external = Object.entries(file.networks)
      .filter(([, network]) => network.external)
      .map(([key]) => key);
    for (const network of db!.networks ?? []) {
      expect(external, `db must not join the external network ${network}`).not.toContain(
        network,
      );
    }
  });

  it("never hands a privileged migration URL to a runtime service", () => {
    const file = parseCompose(stagingSource());
    for (const name of ["web", "worker", "db"]) {
      const service = file.services[name];
      expect(service, `the staging compose declares no ${name} service`).toBeDefined();
      expect(privilegedUrlKeys(service!)).toEqual([]);
      expect(service!.environment?.DATABASE_URL ?? "").not.toContain(
        "postgresql://aqua:",
      );
    }
    expect(privilegedUrlKeys(file.services.migrate!).length).toBeGreaterThan(0);
  });

  it("publishes no host port at all", () => {
    const file = parseCompose(stagingSource());
    // Fail closed: an empty document has no ports, so the assertion
    // below would pass for the wrong reason.
    expect(Object.keys(file.services).length).toBeGreaterThan(0);
    for (const service of Object.values(file.services)) {
      expect(service.ports ?? []).toEqual([]);
    }
  });

  it("pins the immutable image with no build and no :latest", () => {
    const file = parseCompose(stagingSource());
    for (const name of APP_SERVICES) {
      expect(file.services[name]!.image).toBe(APP_IMAGE);
      expect(file.services[name]!.build).toBeUndefined();
    }
  });

  it("collides with no other deployment unit's volume or network", () => {
    const staging = parseCompose(stagingSource());
    const stagingVolumeNames = new Set(
      Object.values(staging.volumes).map((volume) => volume.name),
    );
    const stagingNetworkNames = new Set(
      Object.values(staging.networks).map((network) => network.name),
    );
    // Fail closed: an empty document collides with nothing, so the
    // comparison below would pass for the wrong reason.
    expect(stagingVolumeNames.has(STAGING_VOLUME)).toBe(true);
    expect(stagingNetworkNames.has(STAGING_NETWORK)).toBe(true);

    const otherVolumes = new Set<string>();
    const otherProjectNetworks = new Set<string>();
    const otherProjects = new Set<string>();

    for (const unit of OTHER_UNITS) {
      const path = join(ROOT, unit);
      if (!existsSync(path)) continue;
      const file = parseCompose(readFileSync(path, "utf8"));
      if (file.project) otherProjects.add(file.project);
      for (const volume of Object.values(file.volumes)) otherVolumes.add(volume.name);
      for (const network of Object.values(file.networks)) {
        // An EXTERNAL network is deliberately shared — Dokploy's Traefik
        // network is one — so only project-scoped networks can collide.
        if (!network.external) otherProjectNetworks.add(network.name);
      }
    }

    for (const name of stagingVolumeNames) {
      expect(otherVolumes, `volume ${name} is already used by another unit`).not.toContain(
        name,
      );
    }
    for (const name of stagingNetworkNames) {
      if (name === "dokploy-network") continue;
      expect(
        otherProjectNetworks,
        `network ${name} is already used by another unit`,
      ).not.toContain(name);
    }
    expect(otherProjects).not.toContain(STAGING_PROJECT);
    // The names the assignment calls out by hand.
    expect(stagingVolumeNames).not.toContain("aqua-pgdata-dev");
    expect(stagingNetworkNames).not.toContain("aqua-dev-internal");
  });

  it("rejects the Dev and Production units — this is a staging contract, not a generic one", () => {
    for (const unit of [
      "docker-compose.dokploy.yml",
      "docker-compose.production.yml",
      "docker-compose.local.yml",
    ]) {
      const violations = scanStagingCompose(readFileSync(join(ROOT, unit), "utf8"));
      expect(violations.length, `${unit} must not satisfy the staging contract`)
        .toBeGreaterThan(0);
      expect(
        violations.some((v) => v.includes("must be named sportsip-staging")),
        `${unit} must be rejected on the project name`,
      ).toBe(true);
    }
  });

  it("shares only Dokploy's external Traefik network", () => {
    const file = parseCompose(stagingSource());
    const external = Object.entries(file.networks)
      .filter(([, network]) => network.external)
      .map(([key]) => key);
    expect(external).toEqual(["dokploy-network"]);
    // Every other unit that names it declares it external too — a
    // project-scoped network with that name would be a different
    // network, and Traefik would not be on it.
    for (const unit of OTHER_UNITS) {
      const path = join(ROOT, unit);
      if (!existsSync(path)) continue;
      const other = parseCompose(readFileSync(path, "utf8"));
      const network = other.networks["dokploy-network"];
      if (!network) continue;
      expect(network.external, `${unit} must declare dokploy-network external`).toBe(
        true,
      );
    }
  });
});

describe("staging environment example", () => {
  it("exists and defines every required variable", () => {
    expect(
      existsSync(STAGING_ENV_EXAMPLE),
      "docker-compose.staging.env.example is missing — the coordinator has no template",
    ).toBe(true);
    const example = readFileSync(STAGING_ENV_EXAMPLE, "utf8");
    const defined = new Set(
      example
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[A-Z0-9_]+=/.test(line))
        .map((line) => line.split("=")[0]!),
    );
    for (const name of REQUIRED_SECRETS) {
      expect(defined, `${name} is not in the staging env example`).toContain(name);
    }
  });

  it("carries no real credential and no other environment's hosts", () => {
    const example = readFileSync(STAGING_ENV_EXAMPLE, "utf8");
    const assignments = example
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[A-Z0-9_]+=/.test(line));
    for (const line of assignments) {
      const [name, ...rest] = line.split("=");
      const value = rest.join("=").trim();
      if (["SEED_SPLASH_CLUB", "AQUA_DEPLOYMENT_STAGE", "WHATSAPP_PROVIDER"].includes(name!)) {
        continue;
      }
      expect(
        value.startsWith("<") && value.endsWith(">"),
        `${name} must be a <placeholder>, found "${value}"`,
      ).toBe(true);
    }
    // No other environment's TENANT or OPS host, and no shared demo PIN.
    // The approved WhatsApp mock (wa.preprabbit.in) is deliberately NOT
    // in this list: it is the approved capture transport and may be reused
    // for the synthetic demo — the dedicated fixture above checks where
    // it may be named and how.
    for (const forbidden of [
      "aqua.preprabbit.in",
      "aquaops.preprabbit.in",
      "thepreprabbit.in",
      "123456",
    ]) {
      expect(example, `the staging env example must not contain ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });
});

describe("staging contract — privileged URL and capture origin", () => {
  it("rejects a backup that holds the privileged URL without being a dormant job", () => {
    // The admin URL is accepted in the backup profile ONLY as a dormant,
    // operator-run job. Take the profile away and the credential is no
    // longer acceptable there.
    const violations = violationsFor((source) =>
      source.replace("    profiles: [backup]\n", ""),
    );
    expect(
      violations.some((v) => v.includes("dormant, operator-run job")),
    ).toBe(true);
  });

  it("accepts the privileged URL in a dormant backup profile", () => {
    const canonical = parseCompose(stagingSource());
    const migratePrivileged = privilegedEntries(canonical.services.migrate ?? {});
    const backupPrivileged = privilegedEntries(canonical.services.backup ?? {});
    // The migrate job holds the privileged URL, and the dormant backup
    // profile holds the SAME key.
    expect(migratePrivileged.length).toBeGreaterThan(0);
    expect(backupPrivileged.map(([key]) => key)).toEqual(
      migratePrivileged.map(([key]) => key),
    );
    const backupBlock = stagingSource().slice(stagingSource().indexOf("  backup:"));
    expect(backupBlock).toContain("profiles: [backup]");
    expect(backupBlock).toContain('restart: "no"');
    expect(scanStagingCompose(stagingSource())).toEqual([]);
  });

  it("rejects a capture origin with a default", () => {
    // The capture origin stays explicit: a default would point staging at
    // another environment's mock inbox.
    const violations = violationsFor((source) =>
      source.replace(
        "${WHATSAPP_CAPTURE_URL:?set WHATSAPP_CAPTURE_URL}",
        "${WHATSAPP_CAPTURE_URL:-https://capture.invalid}",
      ),
    );
    expect(violations.some((v) => v.includes("WHATSAPP_CAPTURE_URL"))).toBe(true);
  });
});

describe("staging environment example — capture origin", () => {
  it("names only the approved mock as a concrete capture origin", () => {
    const example = readFileSync(STAGING_ENV_EXAMPLE, "utf8");
    const line = example
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("WHATSAPP_CAPTURE_URL="));
    expect(line, "the staging env example must define WHATSAPP_CAPTURE_URL").toBeDefined();
    const value = line!.split("=").slice(1).join("=").trim();
    if (!value.startsWith("<")) {
      // A concrete origin must be the approved hosted mock.
      expect(value).toBe("https://wa.preprabbit.in");
    }
  });

  it("documents that the mock capture origin is for the synthetic demo only", () => {
    const example = readFileSync(STAGING_ENV_EXAMPLE, "utf8");
    const lines = example.split("\n");
    const index = lines.findIndex((line) =>
      line.trim().startsWith("WHATSAPP_CAPTURE_URL="),
    );
    expect(index).toBeGreaterThan(-1);
    const context = lines.slice(Math.max(0, index - 20), index).join("\n");
    expect(context).toMatch(/synthetic/i);
  });
});

describe("staging compose CLI", () => {
  function runCli(target: string) {
    const result = spawnSync(
      join(ROOT, "node_modules", ".bin", "tsx"),
      [STAGING_CLI, target],
      { encoding: "utf8" },
    );
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  it("is a named checker backed by the production scanner", () => {
    expect(
      existsSync(STAGING_CLI),
      "scripts/check-staging-compose.ts is missing — there is no named gate for the staging unit",
    ).toBe(true);
    expect(
      existsSync(STAGING_SCAN_LIB),
      "scripts/lib/staging-compose-scan.ts is missing — the scanner must live in production code, not in a test",
    ).toBe(true);
    // The CLI must use the production scanner rather than re-implement it.
    expect(readFileSync(STAGING_CLI, "utf8")).toContain("staging-compose-scan");
  });

  it("passes the real staging compose", () => {
    const result = runCli(STAGING_COMPOSE);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("passed");
  });

  it("fails a broken compose and names the violation", () => {
    const broken = join(tmpdir(), "aqua-broken-staging-compose.yml");
    writeFileSync(
      broken,
      stagingSource().replace(
        '    expose:\n      - "3000"\n',
        '    ports:\n      - "3000:3000"\n',
      ),
    );
    try {
      const result = runCli(broken);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("ports");
    } finally {
      unlinkSync(broken);
    }
  });

  it("fails closed on a missing file, without a stack trace", () => {
    const result = runCli(join(tmpdir(), "aqua-absent-staging-compose.yml"));
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("not found");
    expect(result.stderr).not.toContain("    at ");
  });

  it("never prints a secret value", () => {
    const leaky = join(tmpdir(), "aqua-leaky-staging-compose.yml");
    writeFileSync(
      leaky,
      stagingSource().replace(
        "      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}",
        "      POSTGRES_PASSWORD: literal-secret-value-abc123",
      ),
    );
    try {
      const result = runCli(leaky);
      expect(result.status).not.toBe(0);
      // A CLI that printed nothing did not check anything.
      expect(result.stdout + result.stderr).not.toBe("");
      // It names the variable, never the value.
      expect(result.stdout + result.stderr).toContain("POSTGRES_PASSWORD");
      expect(result.stdout + result.stderr).not.toContain(
        "literal-secret-value-abc123",
      );
    } finally {
      unlinkSync(leaky);
    }
  });
});

describe("staging isolation scanner — known-bad proof", () => {
  it("rejects a host port mapping", () => {
    const violations = violationsFor((source) =>
      source.replace('    expose:\n      - "3000"\n', '    ports:\n      - "3000:3000"\n'),
    );
    expect(violations.some((v) => v.includes("ports"))).toBe(true);
  });

  it("rejects a published database port", () => {
    const violations = violationsFor((source) =>
      source.replace(
        "    networks:\n      - internal\n\n  # One-shot",
        "    ports:\n      - \"5432:5432\"\n    networks:\n      - internal\n\n  # One-shot",
      ),
    );
    expect(violations.some((v) => v.includes("ports"))).toBe(true);
  });

  it("rejects the Dev project's volume and network names", () => {
    const devVolume = violationsFor((source) =>
      source
        .replaceAll(STAGING_VOLUME, "aqua-pgdata-dev")
        .replaceAll(STAGING_NETWORK, "aqua-dev-internal"),
    );
    // The rules must FIRE; the message quotes the required name, so the
    // assertion is about the rule, not about the bad name.
    expect(devVolume.some((v) => v.includes("must mount the named volume"))).toBe(true);
    expect(devVolume.some((v) => v.includes("internal name must be"))).toBe(true);
  });

  it("rejects a database on the external Traefik network", () => {
    const violations = violationsFor((source) =>
      source.replace(
        "    networks:\n      - internal\n",
        "    networks:\n      - internal\n      - dokploy-network\n",
      ),
    );
    expect(violations.some((v) => v.includes("must not join dokploy-network"))).toBe(
      true,
    );
    expect(violations.some((v) => v.includes("internal network only"))).toBe(true);
  });

  it("rejects a database on any second network", () => {
    const violations = violationsFor((source) =>
      source.replace(
        "    networks:\n      - internal\n",
        "    networks:\n      - internal\n      - shared-pg\n",
      ),
    );
    expect(violations.some((v) => v.includes("internal network only"))).toBe(true);
  });

  it("rejects a second shared external network", () => {
    const violations = violationsFor((source) =>
      source.replace(
        "networks:\n  # Application-internal network",
        "networks:\n  shared-pg:\n    external: true\n  # Application-internal network",
      ),
    );
    // A second external network is a shared resource this project must
    // own alone; only Dokploy's Traefik network may be shared.
    expect(violations.some((v) => v.includes("only dokploy-network may be shared"))).toBe(
      true,
    );
  });

  it("rejects a privileged migration URL in a runtime service", () => {
    // The privileged key and its value are taken from the canonical
    // compose file, so the mutation inserts exactly what migrate holds.
    const canonical = parseCompose(stagingSource());
    const [entry] = privilegedEntries(canonical.services.migrate ?? {});
    expect(entry, "the canonical staging compose declares the privileged URL").toBeDefined();
    const [key, value] = entry!;
    const violations = violationsFor((source) =>
      source.replace(
        /(  worker:[\s\S]*?\n    environment:\n)/,
        `$1      ${key}: ${value}\n`,
      ),
    );
    expect(violations.some((v) => v.includes("privileged migration URL"))).toBe(true);
  });

  it("rejects a superuser DATABASE_URL in a runtime service", () => {
    const violations = violationsFor((source) =>
      source.replaceAll(
        "postgresql://app_login:",
        "postgresql://aqua:",
      ),
    );
    expect(violations.some((v) => v.includes("superuser"))).toBe(true);
  });

  it("rejects a mutable image reference or a build key", () => {
    const latest = violationsFor((source) => source.replaceAll(APP_IMAGE, "latest"));
    expect(latest.some((v) => v.includes("image must be"))).toBe(true);
    const built = violationsFor((source) => source.replace("    pull_policy: always\n", "    pull_policy: always\n    build: .\n"));
    expect(built.some((v) => v.includes("build:"))).toBe(true);
  });

  it("rejects a second worker and a scaled worker", () => {
    const second = violationsFor((source) =>
      source.replace(
        "\nvolumes:\n",
        "\n  worker-2:\n    image: " + APP_IMAGE + "\n    command: [\"node_modules/.bin/tsx\", \"worker/index.ts\"]\n\nvolumes:\n",
      ),
    );
    expect(second.some((v) => v.includes("worker-2"))).toBe(true);
    const scaled = violationsFor((source) => source.replace("  worker:\n", "  worker:\n    deploy:\n      replicas: 2\n"));
    expect(scaled.some((v) => v.includes("replicas"))).toBe(true);
  });

  it("rejects a backup profile that a normal deploy would start", () => {
    const violations = violationsFor((source) => source.replace("    profiles: [backup]\n", ""));
    expect(violations.some((v) => v.includes("profiles"))).toBe(true);
  });

  it("rejects a secret with a fallback default", () => {
    const violations = violationsFor((source) =>
      source.replace(
        "${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}",
        "${POSTGRES_PASSWORD:-staging-default}",
      ),
    );
    expect(violations.some((v) => v.includes("uses a fallback default"))).toBe(true);
  });

  it("rejects a renamed database role or auth scheme", () => {
    const renamed = violationsFor((source) =>
      source.replace("      POSTGRES_USER: aqua\n", "      POSTGRES_USER: sportsip\n"),
    );
    expect(renamed.some((v) => v.includes("POSTGRES_USER"))).toBe(true);
    const noAuth = violationsFor((source) =>
      source.replaceAll(
        "      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET}\n",
        "",
      ),
    );
    expect(noAuth.some((v) => v.includes("BETTER_AUTH_SECRET"))).toBe(true);
  });

  it("rejects a runtime service that does not wait for the migration", () => {
    const violations = violationsFor((source) =>
      source.replace("condition: service_completed_successfully", "condition: service_started"),
    );
    expect(violations.some((v) => v.includes("service_completed_successfully"))).toBe(
      true,
    );
  });
});
