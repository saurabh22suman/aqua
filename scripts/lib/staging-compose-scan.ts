// The staging deployment unit's isolation contract, as reusable code.
//
// This module is the production half of the staging-isolation contract:
// `scripts/check-staging-compose.ts` runs it against
// `docker-compose.staging.yml`, and
// `tests/scanner-fixtures/staging-isolation.test.ts` proves every rule can
// fail. Nothing in here starts a container, reads a database or touches the
// network — it is a pure source parse, like
// `scripts/lib/dokploy-compose-scan.ts`.
//
// WHY THE CONTRACT EXISTS
//
// Two Compose projects on one Docker host share everything Docker namespaces
// by NAME: the project, the named volumes and the networks. One wrong name
// and a staging preview silently writes into the Dev pilot's database. The
// rules below are the machine-checkable form of that fear:
//
//   * the project, the database volume and the internal network are named
//     independently of every other deployment unit;
//   * the database is never on an external network and never publishes a
//     host port;
//   * the privileged migration URL never reaches a runtime service — it is
//     accepted in the backup profile only as a dormant, operator-run job;
//   * the image is immutable and every secret fails closed.
//
// THE PARSER
//
// The repo has no YAML library — `scripts/lib/dokploy-compose-scan.ts` says
// so explicitly and says adding one needs a decision. This parser therefore
// reads the compose subset the repo actually uses: nested maps, block
// sequences, inline flow sequences and scalars. It is deliberately strict:
// anything it cannot read is a missing value, and the rules below treat a
// missing value as a violation, so an unparseable file fails the check
// rather than passing it.

import { scanComposeSecrets } from "./compose-secrets-scan";

export const STAGING_COMPOSE_FILE = "docker-compose.staging.yml";

export const STAGING_PROJECT = "sportsip-staging";
export const STAGING_VOLUME = "sportsip-staging-pgdata";
export const STAGING_NETWORK = "sportsip-staging-internal";

// The immutable image reference every application service must use. The
// staging deployment runs the SAME published build as Dev: a staging
// preview of a different image proves nothing.
export const APP_IMAGE =
  "ghcr.io/saurabh22suman/aqua:${AQUA_IMAGE_TAG:?set AQUA_IMAGE_TAG}";

export const APP_SERVICES = ["migrate", "web", "worker", "backup"] as const;
export const EXPECTED_SERVICES = ["backup", "db", "migrate", "web", "worker"] as const;

// The services that run continuously. The privileged URL must never be
// reachable from one of them.
export const RUNTIME_SERVICES = ["web", "worker", "db"] as const;

// Every value that must be present, without a fallback, so a missing
// secret or a missing image tag refuses the deploy instead of starting on
// a placeholder.
export const REQUIRED_SECRETS = [
  "POSTGRES_PASSWORD",
  "APP_LOGIN_PASSWORD",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "PARENT_LINK_SECRET",
  "OPS_HOST",
  "OPS_EMAIL",
  "OPS_PASSWORD",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "AUDIT_CHECKPOINT_SECRET",
  "AQUA_IMAGE_TAG",
  // The capture origin stays explicit. A default would point a staging
  // deployment at another environment's mock inbox.
  "WHATSAPP_CAPTURE_URL",
] as const;

// Keys whose value must never be written literally into a tracked compose
// file: a literal there is a committed credential. The rule reports the
// KEY only — a scanner that prints the value it is complaining about
// would put the secret into CI logs.
export const SENSITIVE_ENV_KEYS = [
  "POSTGRES_PASSWORD",
  "APP_LOGIN_PASSWORD",
  "BETTER_AUTH_SECRET",
  "PARENT_LINK_SECRET",
  "AUDIT_CHECKPOINT_SECRET",
  "R2_SECRET_ACCESS_KEY",
  "OPS_PASSWORD",
] as const;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type YamlValue = string | YamlValue[] | { [key: string]: YamlValue };

type Line = { indent: number; text: string };

export type Service = {
  image?: string;
  build?: string;
  ports?: string[];
  expose?: string[];
  networks?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  restart?: string;
  profiles?: string[];
  command?: string[];
  dependsOn?: Record<string, string>;
};

export type ComposeFile = {
  project: string;
  services: Record<string, Service>;
  volumes: Record<string, { name: string }>;
  networks: Record<string, { name: string; external: boolean }>;
};

function stripComment(raw: string): string {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("#")) return "";
  // A comment starts at " #" outside a quoted scalar. The compose files
  // in this repo never carry a "#" inside a value.
  const hash = raw.indexOf(" #");
  return hash === -1 ? raw : raw.slice(0, hash);
}

function tokenize(source: string): Line[] {
  const lines: Line[] = [];
  for (const raw of source.split("\n")) {
    const text = stripComment(raw).trimEnd();
    if (text.trim() === "") continue;
    lines.push({
      indent: text.length - text.trimStart().length,
      text: text.trim(),
    });
  }
  return lines;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseScalar(raw: string): YamlValue {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => unquote(item.trim()));
  }
  return unquote(value);
}

function splitKey(text: string): { key: string; rest: string } {
  const match = text.match(/^([^:]+):(?:\s+(.*))?$/);
  if (!match) return { key: text, rest: "" };
  return { key: match[1]!.trim(), rest: (match[2] ?? "").trim() };
}

function parseBlock(lines: Line[], start: number, indent: number): [YamlValue, number] {
  if (lines[start]?.text.startsWith("- ")) {
    const list: YamlValue[] = [];
    let i = start;
    while (
      i < lines.length &&
      lines[i]!.indent === indent &&
      lines[i]!.text.startsWith("- ")
    ) {
      list.push(parseScalar(lines[i]!.text.slice(2)));
      i += 1;
    }
    return [list, i - start];
  }
  const map: { [key: string]: YamlValue } = {};
  let i = start;
  while (
    i < lines.length &&
    lines[i]!.indent === indent &&
    !lines[i]!.text.startsWith("- ")
  ) {
    const { key, rest } = splitKey(lines[i]!.text);
    if (rest === "") {
      const next = lines[i + 1];
      if (next && next.indent > indent) {
        const [value, consumed] = parseBlock(lines, i + 1, next.indent);
        map[key] = value;
        i += consumed + 1;
      } else {
        map[key] = "";
        i += 1;
      }
    } else {
      map[key] = parseScalar(rest);
      i += 1;
    }
  }
  return [map, i - start];
}

export function parseYaml(source: string): { [key: string]: YamlValue } {
  const lines = tokenize(source);
  if (lines.length === 0) return {};
  const [value] = parseBlock(lines, 0, lines[0]!.indent);
  return (value ?? {}) as { [key: string]: YamlValue };
}

function asStringList(value: YamlValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value !== "") return [value];
  return [];
}

function asRecord(value: YamlValue | undefined): Record<string, YamlValue> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, YamlValue>;
  }
  return {};
}

/**
 * Parse a compose document into the model the scanner works on. A volume
 * or network without a pinned `name:` resolves to its key, which is how
 * Compose names it inside the project.
 */
export function parseCompose(source: string): ComposeFile {
  const doc = parseYaml(source);
  const services: Record<string, Service> = {};
  for (const [name, raw] of Object.entries(asRecord(doc.services))) {
    const block = asRecord(raw);
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(asRecord(block.environment))) {
      environment[key] = String(value ?? "");
    }
    const dependsOn: Record<string, string> = {};
    for (const [key, value] of Object.entries(asRecord(block.depends_on))) {
      if (typeof value === "string") dependsOn[key] = value;
      else dependsOn[key] = String(asRecord(value).condition ?? "");
    }
    services[name] = {
      image: typeof block.image === "string" ? block.image : undefined,
      build: typeof block.build === "string" ? block.build : undefined,
      ports: asStringList(block.ports),
      expose: asStringList(block.expose),
      networks: asStringList(block.networks),
      volumes: asStringList(block.volumes),
      environment,
      restart: typeof block.restart === "string" ? block.restart : undefined,
      profiles: asStringList(block.profiles),
      command: asStringList(block.command),
      dependsOn,
    };
  }

  const volumes: Record<string, { name: string }> = {};
  for (const [key, raw] of Object.entries(asRecord(doc.volumes))) {
    const block = asRecord(raw);
    const pinned = typeof block.name === "string" ? block.name : "";
    volumes[key] = { name: pinned === "" ? key : pinned };
  }

  const networks: Record<string, { name: string; external: boolean }> = {};
  for (const [key, raw] of Object.entries(asRecord(doc.networks))) {
    const block = asRecord(raw);
    const pinned = typeof block.name === "string" ? block.name : "";
    networks[key] = {
      name: pinned === "" ? key : pinned,
      external: String(block.external ?? "") === "true",
    };
  }

  return {
    project: typeof doc.name === "string" ? doc.name : "",
    services,
    volumes,
    networks,
  };
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export function privilegedUrlKeys(service: Service): string[] {
  return Object.keys(service.environment ?? {}).filter((key) =>
    /^MIGRATION_[A-Z_]*URL$/.test(key),
  );
}

/**
 * Scan a staging compose document. Returns one message per violation; an
 * empty array means the document satisfies the contract.
 */
export function scanStagingCompose(source: string): string[] {
  const violations: string[] = [];
  const file = parseCompose(source);

  if (file.project !== STAGING_PROJECT) {
    violations.push(
      `project: must be named ${STAGING_PROJECT} — found "${file.project || "(none)"}".`,
    );
  }

  const names = Object.keys(file.services).sort();
  const expected = [...EXPECTED_SERVICES].join(",");
  if (names.join(",") !== expected) {
    violations.push(
      `services: expected exactly ${EXPECTED_SERVICES.join(", ")} — found ${names.join(", ") || "(none)"}.`,
    );
  }

  // No host port may ever be published: the database must not be reachable
  // from the host, and the application is reached by Traefik over the
  // external network instead.
  for (const [name, service] of Object.entries(file.services)) {
    if (service.ports && service.ports.length > 0) {
      violations.push(
        `${name}: ports: present — no host port may be published (${service.ports.join(", ")}).`,
      );
    }
    if (service.build) {
      violations.push(
        `${name}: build: present — the host must pull the immutable image.`,
      );
    }
    if (service.image && /:latest\b/.test(service.image)) {
      violations.push(`${name}: :latest is not an immutable image reference.`);
    }
    if (name !== "web" && service.expose && service.expose.length > 0) {
      violations.push(
        `${name}: expose: present — only web is reachable through Traefik.`,
      );
    }
  }

  for (const name of APP_SERVICES) {
    const service = file.services[name];
    if (!service) continue;
    if (service.image !== APP_IMAGE) {
      violations.push(
        `${name}: image must be ${APP_IMAGE} — found "${service.image ?? "(none)"}".`,
      );
    }
  }
  const db = file.services.db;
  if (db && db.image !== "postgres:16") {
    violations.push(
      `db: image must be postgres:16 — found "${db.image ?? "(none)"}".`,
    );
  }

  // Exactly one worker, and no scaling knob that could add one.
  if (names.filter((name) => name === "worker").length !== 1) {
    violations.push("worker: there must be exactly one worker.");
  }
  if (/^\s*replicas:/m.test(source) || /^\s*scale:/m.test(source)) {
    violations.push(
      "replicas/scale: the worker must stay at exactly one replica.",
    );
  }

  const migrate = file.services.migrate;
  if (migrate) {
    if (migrate.restart !== "no") {
      violations.push('migrate: must be one-shot — `restart: "no"`.');
    }
    if (!(migrate.command ?? []).some((part) => part.includes("db/deploy.ts"))) {
      violations.push("migrate: command must run db/deploy.ts.");
    }
    if (privilegedUrlKeys(migrate).length === 0) {
      violations.push("migrate: missing the privileged migration URL.");
    }
  }

  // The privileged URL is a migrate/backup concern only. A runtime
  // service that holds it can re-migrate, re-grant and read every
  // tenant's data across RLS boundaries.
  for (const name of RUNTIME_SERVICES) {
    const service = file.services[name];
    if (!service) continue;
    const privileged = privilegedUrlKeys(service);
    if (privileged.length > 0) {
      violations.push(
        `${name}: privileged migration URL is forbidden (${privileged.join(", ")}).`,
      );
    }
    const databaseUrl = service.environment?.DATABASE_URL ?? "";
    if (databaseUrl && /postgresql:\/\/aqua:/.test(databaseUrl)) {
      violations.push(
        `${name}: DATABASE_URL uses the superuser role — runtime services must use app_login.`,
      );
    }
  }

  for (const name of ["web", "worker"] as const) {
    const service = file.services[name];
    if (!service) continue;
    if (service.dependsOn?.migrate !== "service_completed_successfully") {
      violations.push(
        `${name}: must depend on migrate with condition: service_completed_successfully.`,
      );
    }
  }

  // The backup profile is dormant and manual: a normal deploy must not
  // start it, and it must never be on the external network. The
  // privileged URL is accepted here ONLY in that dormant, operator-run
  // shape — pg_dump needs it, and a long-lived privileged job must not
  // exist.
  const backup = file.services.backup;
  if (backup) {
    const dormant =
      (backup.profiles ?? []).includes("backup") && backup.restart === "no";
    if (!dormant) {
      violations.push("backup: must be dormant behind profiles: [backup].");
      violations.push('backup: must be one-shot — `restart: "no"`.');
    }
    if (!(backup.command ?? []).some((part) => part.includes("scripts/db-backup.ts"))) {
      violations.push("backup: command must run scripts/db-backup.ts.");
    }
    const backupPrivileged = privilegedUrlKeys(backup);
    if (backupPrivileged.length === 0) {
      violations.push("backup: missing the privileged migration URL (pg_dump needs it).");
    } else if (!dormant) {
      violations.push(
        "backup: the privileged migration URL is only acceptable in a dormant, operator-run job (profiles: [backup], restart: \"no\").",
      );
    }
  }

  // The database's persistent state is its own named volume.
  if (db) {
    const mounts = db.volumes ?? [];
    if (!mounts.some((mount) => mount.startsWith(`${STAGING_VOLUME}:`))) {
      violations.push(`db: must mount the named volume ${STAGING_VOLUME}.`);
    }
    for (const mount of mounts) {
      if (mount.startsWith("/") || mount.startsWith(".")) {
        violations.push(`db: bind mount "${mount}" — use the named volume.`);
      }
    }
    // The database sits on the internal network and nowhere else. Any
    // second network — Traefik's or otherwise — puts a reachable
    // Postgres on it.
    const dbNetworks = db.networks ?? [];
    if (dbNetworks.length !== 1 || dbNetworks[0] !== "internal") {
      violations.push(
        `db: must be on the internal network only (found ${dbNetworks.join(", ") || "none"}) — the database is never routed.`,
      );
    }
  }
  const stagingVolume = file.volumes[STAGING_VOLUME];
  if (!stagingVolume) {
    violations.push(
      `volumes: top-level named volume ${STAGING_VOLUME} is missing.`,
    );
  } else if (stagingVolume.name !== STAGING_VOLUME) {
    violations.push(
      `volumes: ${STAGING_VOLUME} must pin its name so project naming cannot rename it.`,
    );
  }

  // Networks: one internal network of its own, plus Traefik's external
  // one for web only. The database must never be on an external network.
  const internal = file.networks.internal;
  if (!internal || internal.name !== STAGING_NETWORK) {
    violations.push(`networks: internal name must be ${STAGING_NETWORK}.`);
  }
  const dokploy = file.networks["dokploy-network"];
  if (!dokploy || !dokploy.external) {
    violations.push(
      "networks: dokploy-network must exist as external: true (Traefik's network).",
    );
  }
  // Traefik's network is shared BY DESIGN — every deployment unit joins
  // the same one. Any OTHER external network would be a second shared
  // resource this project must own alone.
  for (const [key, network] of Object.entries(file.networks)) {
    if (network.external && key !== "dokploy-network") {
      violations.push(
        `networks: ${key} is external — only dokploy-network may be shared with another unit.`,
      );
    }
  }
  for (const [name, service] of Object.entries(file.services)) {
    const networks = service.networks ?? [];
    if (!networks.includes("internal")) {
      violations.push(`${name}: must join the internal network.`);
    }
    if (name === "web") {
      if (!networks.includes("dokploy-network")) {
        violations.push("web: must join dokploy-network for Traefik routing.");
      }
    } else if (networks.includes("dokploy-network")) {
      violations.push(
        `${name}: must not join dokploy-network — only web is routed by Traefik.`,
      );
    }
  }

  // Fail closed: no secret may fall back to a placeholder, and every
  // required value must be referenced as required.
  for (const name of REQUIRED_SECRETS) {
    if (new RegExp(`\\$\\{${name}:-`).test(source)) {
      violations.push(`${name}: uses a fallback default — use \${${name}:?message}.`);
    }
    if (!new RegExp(`\\$\\{${name}:\\?`).test(source)) {
      violations.push(`${name}: must be referenced as required (\${${name}:?}).`);
    }
  }

  // A secret value is an interpolation, never a literal. The message
  // names the KEY only — never the value.
  for (const [serviceName, service] of Object.entries(file.services)) {
    for (const key of SENSITIVE_ENV_KEYS) {
      const value = service.environment?.[key];
      if (value === undefined) continue;
      if (!/^\$\{[A-Za-z0-9_]+(:\?[^}]*)?\}$/.test(value)) {
        violations.push(
          `${serviceName}: ${key} must be interpolated (\${VAR}), never a literal value.`,
        );
      }
    }
  }

  // The authentication scheme and the database roles are unchanged: this
  // is a new deployment unit, not a rename.
  if (db) {
    if (db.environment?.POSTGRES_USER !== "aqua") {
      violations.push("db: POSTGRES_USER must stay `aqua` — no database-user rename.");
    }
    if (db.environment?.POSTGRES_DB !== "aqua") {
      violations.push("db: POSTGRES_DB must stay `aqua` — no database-name rename.");
    }
  }
  for (const name of ["web", "worker"] as const) {
    const service = file.services[name];
    if (!service) continue;
    const databaseUrl = service.environment?.DATABASE_URL ?? "";
    if (databaseUrl && !databaseUrl.includes("postgresql://app_login:")) {
      violations.push(`${name}: DATABASE_URL must use the app_login role.`);
    }
    if (!service.environment?.BETTER_AUTH_SECRET) {
      violations.push(`${name}: BETTER_AUTH_SECRET is required — no auth-scheme change.`);
    }
  }

  // Preview deployment, mocked providers only: the stage makes the app
  // disclose that messages are captured rather than delivered.
  for (const name of ["web", "worker"] as const) {
    const service = file.services[name];
    if (!service) continue;
    const provider = service.environment?.WHATSAPP_PROVIDER ?? "";
    if (!/\$\{WHATSAPP_PROVIDER:-capture\}/.test(provider)) {
      violations.push(
        `${name}: WHATSAPP_PROVIDER must default to the mocked capture transport.`,
      );
    }
    const stage = service.environment?.AQUA_DEPLOYMENT_STAGE ?? "";
    if (!/\$\{AQUA_DEPLOYMENT_STAGE:-preview\}/.test(stage)) {
      violations.push(`${name}: AQUA_DEPLOYMENT_STAGE must default to preview.`);
    }
  }

  // The shared production contract for required secrets applies here too.
  violations.push(...scanComposeSecrets(source));

  return violations;
}
