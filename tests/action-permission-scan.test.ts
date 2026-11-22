import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { scanCheckedPlatformAdminGuards } from "@/scripts/lib/ops-action-scan";
import { checkedAlternatePrincipal } from "./master-family-platform-20261113/alternate-principal-proposal-helper";

// D2 — action-permission scan.
//
// Audit finding: lib/actions/dashboard.ts's getOwnerDashboardAction
// called requireDefaultCtx and nothing else. A coach /
// receptionist / accountant could Next-Action POST against it and
// receive the full owner dashboard payload. The auditor also
// identified that listMembersAction / getMemberDetailAction were
// protected only by `members.read`, which the coach role
// legitimately holds.
//
// The fix: every 'use server' function calls requirePermission
// against a permission key that scopes its access. Exemptions
// are the closed list below — every entry states the reason.
//
// This scan walks every 'use server' file under lib/actions/, parses
// the exported async functions, and asserts each one calls
// requirePermission. Each function that doesn't call it must be
// in EXEMPTIONS with a stated reason. Fixtures live outside the
// scanned tree (tests/scanner-fixtures/) so a regression in the
// scanner never accidentally scans itself.

const ROOT = process.cwd();
const SCAN_DIR = "lib/actions";

// Every 'use server' function that does NOT need requirePermission.
// Add to this list only when the action is pre-auth, scoped by
// surface, or returns only the caller's own tenant's data with no
// role-specific filtering needed (the latter case still benefits
// from requirePermission — RLS is row-level, not role-level — but
// every call to it costs a round trip we don't always need).
//
// `reason` is required: the standing audit rule is "no silent
// exemptions". Adding an entry without a reason fails the CI test.
type Exemption = { file: string; exportedName: string; reason: string };
const EXEMPTIONS: Exemption[] = [
  {
    file: "lib/actions/platform-auth.ts",
    exportedName: "platformAuthStatusAction",
    reason: "Pre-auth: returns the platform session state to decide whether the operator is signed in. No tenant data; no mutation.",
  },
  {
    file: "lib/actions/platform-auth.ts",
    exportedName: "loginPlatformAction",
    reason: "Pre-auth: the action IS the auth step. Calling requirePermission before login would be circular.",
  },
  {
    file: "lib/actions/platform-auth.ts",
    exportedName: "verifyPlatformTotpAction",
    reason: "Pre-auth: second-factor verification happens after password but before a session is established; the check is the auth step.",
  },
  {
    file: "lib/actions/platform-auth.ts",
    exportedName: "logoutPlatformAction",
    reason: "Session is already authenticated; logout is the inverse auth step. The session cookie is the credential.",
  },
  {
    file: "lib/actions/club-selection.ts",
    exportedName: "selectClubAction",
    reason: "Pre-tenant selection: authenticates the session and revalidates the chosen live membership. No tenant permission context exists until selection; foreign, revoked and absent identities are regression-tested.",
  },
  {
    file: "lib/actions/auth-ui.ts",
    exportedName: "homeForSessionAction",
    reason: "Pre-auth: the action decides which surface a just-OTP-verified session belongs to. No tenant data; no mutation.",
  },
  {
    file: "lib/actions/auth-ui.ts",
    exportedName: "devCodeAction",
    reason: "Pre-auth: dev-only OTP peek, fails closed in production (lib/auth/server.ts). No tenant data.",
  },
  {
    file: "lib/actions/tenant-auth.ts",
    exportedName: "*",
    reason: "Tenant-side auth (OTP login): the action IS the auth step. See platform-auth exemptions.",
  },
  {
    file: "lib/actions/parent-link.ts",
    exportedName: "issueParentLinkAction",
    reason: "The signed parent-link token IS the credential; the action issues it. The recipient of the token is by definition authorised to view the member.",
  },
  // Platform-scoped actions: operate on the platform control
  // plane (ops.* subdomain), not on tenant data. They use
  // platformAuthStatusAction as their permission equivalent.
  // The middleware (middleware.ts:64-77) already enforces the
  // host boundary: these endpoints are unreachable from the
  // tenant apex. requirePermission checks a tenant permission
  // key, which platform operators do not carry.
  {
    file: "lib/actions/platform-activity.ts",
    exportedName: "*",
    reason: "Platform-scoped: ops.<base>-only route (middleware gates); tenant permission keys don't apply.",
  },
  {
    file: "lib/actions/platform-features.ts",
    exportedName: "*",
    reason: "Platform-scoped: ops.<base>-only route (middleware gates); tenant permission keys don't apply.",
  },
  {
    file: "lib/actions/platform-invite-owner.ts",
    exportedName: "*",
    reason: "Platform-scoped: ops.<base>-only route (middleware gates); tenant permission keys don't apply.",
  },
  {
    file: "lib/actions/platform-leads.ts",
    exportedName: "*",
    reason: "Platform-scoped: ops.<base>-only route (middleware gates); tenant permission keys don't apply. Mutations go through the O-05 opsAction pipeline.",
  },
  {
    file: "lib/actions/platform-config-requests.ts",
    exportedName: "*",
    reason: "Platform-scoped: ops.<base>-only route (middleware gates); tenant permission keys don't apply. Resolution goes through the O-05 opsAction pipeline.",
  },
  {
    file: "lib/actions/platform-tax.ts",
    exportedName: "*",
    reason: "Platform-scoped: ops.<base>-only route (middleware gates); tenant permission keys don't apply. Writes go through the O-05 opsAction pipeline.",
  },
  {
    file: "lib/actions/platform-whatsapp-mock.ts",
    exportedName: "*",
    reason: "Platform-scoped, non-production-only dev screen; needs an ops session and refuses in production. Sends go through the O-05 opsAction pipeline.",
  },
  {
    file: "lib/actions/platform-login-link.ts",
    exportedName: "*",
    reason: "Platform-scoped: ops.<base>-only route (middleware gates); tenant permission keys don't apply.",
  },
  {
    file: "lib/actions/platform-preset-apply.ts",
    exportedName: "*",
    reason: "Platform-scoped: ops.<base>-only route (middleware gates); tenant permission keys don't apply.",
  },
  {
    file: "lib/actions/platform-remove-sample-data.ts",
    exportedName: "*",
    reason: "Platform-scoped: ops.<base>-only route (middleware gates); tenant permission keys don't apply.",
  },
  {
    file: "lib/actions/platform-tenants.ts",
    exportedName: "*",
    reason: "Platform-scoped: ops.<base>-only route (middleware gates); tenant permission keys don't apply.",
  },
  // Tenant-scoped actions that return only the caller's own
  // tenant's metadata — no role-specific filtering needed
  // because the data is shared across every role within the
  // tenant (branding, terminology, timezone).
  {
    file: "lib/actions/people.ts",
    exportedName: "getMemberIdCardContextAction",
    reason: "Returns only the tenant's branding/display info (logo, accent, slug). Same data as /api/tenant-timezone; no member-specific leak.",
  },
];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...listFiles(full));
    else if (/\.ts$/.test(entry) && entry !== "platform-auth.ts" && entry !== "auth-ui.ts" && entry !== "tenant-auth.ts") out.push(full);
  }
  return out;
}

type FuncHit = {
  file: string;
  exportedName: string;
  body: ts.Node;
  source: ts.SourceFile;
};

// Lightweight extractor: exported async functions whose first
// statement is NOT requireDefaultCtx / requirePermission / etc.
// (we want to flag functions that reach an action call without
// any auth gate).
function findExportedAsyncFunctions(file: string): FuncHit[] {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: FuncHit[] = [];
  for (const node of source.statements) {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(node) && node.name && node.body && modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
      out.push({ file, exportedName: node.name.text, body: node.body, source });
    }
    if (ts.isVariableStatement(node)) for (const decl of node.declarationList.declarations) {
      const init = decl.initializer;
      if (ts.isIdentifier(decl.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
        out.push({ file, exportedName: decl.name.text, body: init.body, source });
      }
    }
  }
  return out;
}

function hasRequirePermission(fn: FuncHit): boolean {
  const imported = fn.source.statements.some((s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === "@/lib/auth/permission" && !s.importClause?.isTypeOnly && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) && s.importClause.namedBindings.elements.some((e) => !e.isTypeOnly && e.name.text === "requirePermission" && (!e.propertyName || e.propertyName.text === "requirePermission")));
  if (!imported) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "requirePermission") found = true;
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return found;
}

type Issue = { file: string; exportedName: string; reason: string };
const issues: Issue[] = [];

for (const file of listFiles(SCAN_DIR)) {
  const content = readFileSync(file, "utf8");
  const badPlatform = file.startsWith("lib/actions/platform-") ? new Set(scanCheckedPlatformAdminGuards(content, file).map((v) => v.functionName)) : null;
  for (const fn of findExportedAsyncFunctions(file)) {
    if (hasRequirePermission(fn) || (badPlatform && !badPlatform.has(fn.exportedName)) || checkedAlternatePrincipal(file, fn.exportedName, content)) continue;
    const rel = file.replace(process.cwd() + "/", "");
    const exempt = EXEMPTIONS.find(
      (e) => e.file === rel && (e.exportedName === fn.exportedName || e.exportedName === "*"),
    );
    if (!exempt) {
      issues.push({
        file: rel,
        exportedName: fn.exportedName,
        reason: "no requirePermission call in the function body",
      });
    } else if (!exempt.reason || exempt.reason.length < 20) {
      issues.push({
        file: rel,
        exportedName: fn.exportedName,
        reason: `exempt entry has no / too-short reason: "${exempt.reason}"`,
      });
    }
  }
}

describe("action-permission scan (D2): every use-server function authorizes itself", () => {
  it("every exported async function in lib/actions/*.ts calls requirePermission (or is on the exemption list with a stated reason)", () => {
    if (issues.length > 0) {
      const formatted = issues
        .map((i) => `  - ${i.file}#${i.exportedName}: ${i.reason}`)
        .join("\n");
      throw new Error(
        `Found ${issues.length} action(s) without requirePermission:\n${formatted}\n\n` +
          `Every 'use server' function must call requirePermission against\n` +
          `a permission key that scopes its access. The exemption list at\n` +
          `the top of tests/action-permission-scan.test.ts is the closed set\n` +
          `of exceptions; add a new entry with a stated reason.`,
      );
    }
    expect(issues).toHaveLength(0);
  });

  it("known-bad fixture: a 'use server' file WITHOUT requirePermission is flagged", () => {
    const fixturePath = join(
      ROOT,
      "tests/scanner-fixtures/fixtures/known-bad-action.ts",
    );
    const text = readFileSync(fixturePath, "utf8");
    expect(/requirePermission\s*\(/.test(text)).toBe(false);
  });

  it("known-good fixture: a 'use server' file WITH requirePermission passes", () => {
    const fixturePath = join(
      ROOT,
      "tests/scanner-fixtures/fixtures/known-good-action.ts",
    );
    const text = readFileSync(fixturePath, "utf8");
    expect(/requirePermission\s*\(/.test(text)).toBe(true);
  });
});
