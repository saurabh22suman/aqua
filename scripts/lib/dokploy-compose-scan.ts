import { scanComposeSecrets } from "./compose-secrets-scan";

// Deployment PR (feat/deploy-dokploy-compose) — mechanical checks for
// docker-compose.dokploy.yml, the single Dokploy Compose deployment
// unit (db, migrate, web, exactly one worker).
//
// The rules exist because every one of them is a silent production
// failure if broken:
//   * a `build:` key or a `:latest` tag means the VPS rebuilds instead
//     of pulling the immutable GHCR image the publish workflow verified;
//   * a `ports:` mapping exposes 3000 to the internet (Traefik must
//     reach the container over dokploy-network instead);
//   * a second worker double-processes pg-boss queues (job locking is
//     per-job, not per-cluster);
//   * a migrate service that is not one-shot, or web/worker without a
//     completed-migration dependency, serves traffic against an
//     unmigrated schema;
//   * a bind-mounted postgres data dir loses data on redeploy.
//
// Run by `pnpm check:dokploy-compose` in CI. The known-bad proof lives
// in tests/scanner-fixtures/dokploy-compose-fixtures.test.ts.

export const DOKPLOY_COMPOSE_FILE = "docker-compose.dokploy.yml";

export const REQUIRED_SERVICES = ["db", "migrate", "web", "worker"] as const;
export const APP_SERVICES = ["migrate", "web", "worker"] as const;

const APP_IMAGE_RE =
  /^ghcr\.io\/saurabh22suman\/aqua:\$\{AQUA_IMAGE_TAG:\?[^}]+\}$/;

type ServiceBlock = { name: string; lines: string[] };

function stripCommentLines(source: string): string {
  return source
    .split("\n")
    .map((line) => (line.trimStart().startsWith("#") ? "" : line))
    .join("\n");
}

// Line-based service extraction — no YAML dependency (the repo has
// none, and adding one needs an explicit decision). Only the shape this
// file actually uses is parsed: `services:` at column 0, service names
// at two-space indent, children deeper.
function parseServiceBlocks(source: string): ServiceBlock[] {
  const blocks: ServiceBlock[] = [];
  const lines = source.split("\n");
  let inServices = false;
  let current: ServiceBlock | null = null;

  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      current = null;
      continue;
    }
    if (!inServices) continue;
    if (/^[A-Za-z]/.test(line)) break; // next top-level section

    const header = line.match(/^ {2}([a-z0-9_-]+):\s*$/);
    if (header) {
      current = { name: header[1]!, lines: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return blocks;
}

// Read a `key:\n  - item` (or `key: [a, b]`) list nested at four-space
// indent inside a service block.
function stringList(block: ServiceBlock, key: string): string[] {
  const values: string[] = [];
  let inKey = false;
  for (const line of block.lines) {
    const head = line.match(/^ {4}([a-z0-9_-]+):\s*(.*)$/);
    if (head) {
      inKey = head[1] === key;
      if (inKey && head[2]!.trimStart().startsWith("[")) {
        values.push(
          ...head[2]!
            .trim()
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        );
      }
      continue;
    }
    if (!inKey) continue;
    const item = line.match(/^ {6}- (.+)$/);
    if (item) values.push(item[1]!.trim());
    else if (line.trim() !== "") inKey = false;
  }
  return values;
}

function blockSource(block: ServiceBlock): string {
  return block.lines.join("\n");
}

export function scanDokployCompose(source: string): string[] {
  const violations: string[] = [];
  const clean = stripCommentLines(source);
  const blocks = parseServiceBlocks(clean);
  const names = blocks.map((block) => block.name);

  // Exact service set, duplicates included (a second `worker:` is the
  // failure this rule exists for).
  const expected = [...REQUIRED_SERVICES].sort().join(",");
  const actual = [...names].sort().join(",");
  if (actual !== expected) {
    violations.push(
      `services: expected exactly ${REQUIRED_SERVICES.join(", ")} — found ${names.join(", ") || "(none)"}. Exactly one worker and no extra services.`,
    );
  }

  for (const pattern of [
    { re: /^\s*build:/m, message: "build: present — the VPS must pull the immutable image, never rebuild it." },
    { re: /:latest\b/, message: ":latest tag found — only the immutable ${AQUA_IMAGE_TAG:?} is allowed." },
    { re: /^\s*ports:/m, message: "ports: present — no host port may be published. Use expose + dokploy-network (Traefik)." },
    { re: /\breplicas:/, message: "replicas: present — the worker must stay at exactly one replica." },
    { re: /^\s*scale:/m, message: "scale: present — the worker must stay at exactly one replica." },
  ]) {
    if (pattern.re.test(clean)) violations.push(pattern.message);
  }

  const byName = new Map(blocks.map((block) => [block.name, block]));
  for (const name of APP_SERVICES) {
    const block = byName.get(name);
    if (!block) continue;
    const image = blockSource(block).match(/^\s*image:\s*(.+)$/m)?.[1]?.trim();
    if (!image || !APP_IMAGE_RE.test(image)) {
      violations.push(
        `${name}: image must be ghcr.io/saurabh22suman/aqua:\${AQUA_IMAGE_TAG:?…} — found ${image ?? "(none)"}.`,
      );
    }
  }

  const migrate = byName.get("migrate");
  if (migrate) {
    const migrateSource = blockSource(migrate);
    if (!/^\s*restart:\s*["']?no["']?\s*$/m.test(migrateSource)) {
      violations.push('migrate: must be one-shot — `restart: "no"`.');
    }
    if (!migrateSource.includes("db/deploy.ts")) {
      violations.push("migrate: command must run db/deploy.ts.");
    }
  }

  for (const name of ["web", "worker"] as const) {
    const block = byName.get(name);
    if (!block) continue;
    const blockText = blockSource(block);
    if (
      !/^\s*depends_on:\s*$/m.test(blockText) ||
      !/\bmigrate:/.test(blockText) ||
      !/condition:\s*service_completed_successfully/.test(blockText)
    ) {
      violations.push(
        `${name}: must depend on migrate with condition: service_completed_successfully.`,
      );
    }
  }

  const db = byName.get("db");
  if (db) {
    const mounts = stringList(db, "volumes");
    if (!mounts.some((mount) => mount.startsWith("aqua-pgdata-dev:"))) {
      violations.push(
        "db: must mount the named volume aqua-pgdata-dev (persistent database data).",
      );
    }
    for (const mount of mounts) {
      if (mount.startsWith("/") || mount.startsWith(".")) {
        violations.push(
          `db: bind mount "${mount}" — use the named volume; Dokploy cleans host paths on deploy.`,
        );
      }
    }
  }
  if (!/^  aqua-pgdata-dev:\s*$/m.test(clean)) {
    violations.push("volumes: top-level named volume aqua-pgdata-dev is missing.");
  }
  if (!/^\s+name:\s*aqua-pgdata-dev\s*$/m.test(clean)) {
    violations.push(
      "volumes: aqua-pgdata-dev must pin `name: aqua-pgdata-dev` so project naming cannot rename it.",
    );
  }

  if (!/^  dokploy-network:\s*$/m.test(clean) || !/^\s+external:\s*true\s*$/m.test(clean)) {
    violations.push(
      "networks: dokploy-network must exist as external: true (Dokploy's existing Traefik network).",
    );
  }
  for (const block of blocks) {
    const networks = stringList(block, "networks");
    if (!networks.includes("internal")) {
      violations.push(`${block.name}: must join the internal network.`);
    }
    if (block.name === "web") {
      if (!networks.includes("dokploy-network")) {
        violations.push("web: must join dokploy-network for Traefik routing.");
      }
    } else if (networks.includes("dokploy-network")) {
      violations.push(
        `${block.name}: must not join dokploy-network — only web is routed by Traefik.`,
      );
    }
  }

  violations.push(...scanComposeSecrets(source));

  return violations;
}
