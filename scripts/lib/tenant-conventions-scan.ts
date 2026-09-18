import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PLATFORM_TABLES } from "@/db/allowlist";

// H-02 — the tenant-convention scan.
//
// Rule, applied ONLY to migrations at/after TENANT_CONVENTION_CUTOFF
// (everything before is grandfathered):
//
//   1. every `create index` / `create unique index` on a tenant table
//      must lead with `tenant_id`. Platform tables
//      (db/allowlist.ts::PLATFORM_TABLES), pgboss and migration-infra
//      tables are exempt, as are the two pre-tenant lookups below.
//   2. no `default gen_random_uuid()` (v4) in a new migration —
//      UUIDv7 is generated app-side, never by the database default.
//
// Shared by the CLI (scripts/check-tenant-conventions.ts) and its
// fixture test (tests/scanner-fixtures/tenant-conventions-fixtures.test.ts).

export const TENANT_CONVENTION_CUTOFF = "20260918050000";

// Pre-tenant-resolution lookups. The caller runs before app.tenant_id
// exists (login / session resolution / webhook arrival), so a
// tenant-leading index cannot serve it. Keyed `table.column`, with a
// reason — same shape as the location-scope allowlist. Keep this list
// short; H-01 is the only sanctioned entry point.
export const PRE_TENANT_INDEX_EXEMPTIONS: Record<string, string> = {
  "tenant_memberships.user_id":
    "H-01: withUser()/user_resolution runs before a tenant is selected; a tenant-leading index cannot serve the lookup",
  "message_log.provider_message_id":
    "H-01: provider webhook dedupe arrives before tenant resolution (the receiving phone number resolves the tenant)",
};

export type TenantConventionViolation = {
  file: string;
  line: number;
  rule: "index-tenant-leading" | "uuid-v4-default";
  message: string;
};

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function unquote(identifier: string): string {
  return identifier.replace(/"/g, "").toLowerCase();
}

function firstColumn(columnList: string): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < columnList.length; i++) {
    const ch = columnList[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      return unquote(columnList.slice(0, i).trim());
    }
  }
  return unquote(columnList.trim());
}

function extractColumnList(statement: string): string | null {
  const open = statement.indexOf("(");
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < statement.length; i++) {
    if (statement[i] === "(") depth++;
    else if (statement[i] === ")") {
      depth--;
      if (depth === 0) return statement.slice(open + 1, i);
    }
  }
  return null;
}

function isExemptTable(table: string): boolean {
  const raw = unquote(table);
  const bare = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw;
  if ((PLATFORM_TABLES as readonly string[]).includes(bare)) return true;
  if (raw.startsWith("_") || bare.startsWith("_")) return true;
  return raw.startsWith("pgboss") || bare.startsWith("pgboss");
}

export function isMigrationAtOrAfterCutoff(fileName: string): boolean {
  const prefix = fileName.match(/^(\d+)_/)?.[1];
  if (!prefix) return false;
  return BigInt(prefix) >= BigInt(TENANT_CONVENTION_CUTOFF);
}

export function listNewMigrationFiles(root = process.cwd()): string[] {
  return readdirSync(join(root, "db", "migrations"))
    .filter((f) => f.endsWith(".sql") && isMigrationAtOrAfterCutoff(f))
    .sort()
    .map((f) => join("db", "migrations", f));
}

export function scanTenantConventions(
  source: string,
  filePath: string,
): TenantConventionViolation[] {
  const stripped = stripComments(source);
  const violations: TenantConventionViolation[] = [];

  const indexRe = /create\s+(?:unique\s+)?index\b[\s\S]*?;/gi;
  for (const match of stripped.matchAll(indexRe)) {
    const statement = match[0];
    const head = statement.match(/\bon\s+([\w".]+)/i);
    if (!head) continue;
    const table = head[1]!;
    if (isExemptTable(table)) continue;
    const rest = statement.slice(statement.indexOf(head[0]) + head[0].length);
    const columns = extractColumnList(rest);
    if (columns === null) continue;
    const first = firstColumn(columns);
    if (first === "tenant_id") continue;
    const bare = unquote(table).split(".").pop()!;
    if (PRE_TENANT_INDEX_EXEMPTIONS[`${bare}.${first}`]) continue;
    violations.push({
      file: filePath,
      line: lineAt(stripped, match.index ?? 0),
      rule: "index-tenant-leading",
      message: `index on ${bare} does not lead with tenant_id (first column: ${first || "(expression)"})`,
    });
  }

  const v4Re = /default\s+gen_random_uuid\s*\(/gi;
  for (const match of stripped.matchAll(v4Re)) {
    violations.push({
      file: filePath,
      line: lineAt(stripped, match.index ?? 0),
      rule: "uuid-v4-default",
      message:
        "default gen_random_uuid() generates a v4 UUID; UUIDv7 is generated app-side",
    });
  }

  return violations.sort((a, b) => a.line - b.line);
}
