// PR1-C10 — compose secrets must fail fast. The renamed local-only
// docker-compose.local.yml
// used `${VAR:-fallback}` defaults for every secret, so a deploy
// missing POSTGRES_PASSWORD or BETTER_AUTH_SECRET silently came up
// with a known placeholder instead of refusing to start. This scan
// is run by `pnpm check:compose-secrets` in CI; the known-bad proof
// lives in tests/scanner-fixtures/compose-secrets-fixtures.test.ts.

export const REQUIRED_SECRETS = [
  "POSTGRES_PASSWORD",
  "APP_LOGIN_PASSWORD",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "PARENT_LINK_SECRET",
] as const;

export function scanComposeSecrets(source: string): string[] {
  const violations: string[] = [];

  for (const name of REQUIRED_SECRETS) {
    if (new RegExp(`\\$\\{${name}(?::-|-)`).test(source)) {
      violations.push(
        `${name}: uses a fallback default. Use \${${name}:?message} so compose refuses to start without it.`,
      );
    }
    if (!new RegExp(`\\$\\{${name}:\\?`).test(source)) {
      violations.push(
        `${name}: is not referenced as required (\${${name}:?}) anywhere in the compose file.`,
      );
    }
  }

  if (!dbHasRestartPolicy(source)) {
    violations.push(
      "db: missing `restart: unless-stopped` — the database must come back with the host/compose.",
    );
  }

  return violations;
}

function dbHasRestartPolicy(source: string): boolean {
  let inDb = false;
  for (const line of source.split("\n")) {
    const service = line.match(/^ {2}([a-z0-9_-]+):\s*$/);
    if (service) {
      inDb = service[1] === "db";
      continue;
    }
    if (inDb && /^\s+restart:\s*unless-stopped\s*$/.test(line)) return true;
  }
  return false;
}
