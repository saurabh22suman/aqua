import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as ts from "typescript";
import { expect, it } from "vitest";

it("does not pass privileged setup credentials to the actual parent-link build child", () => {
  const dir = mkdtempSync(join(tmpdir(), "aqua-e2e-child-"));
  try {
    const output = join(dir, "child.json");
    writeFileSync(join(dir, "pnpm"), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.CHILD_ENV_CAPTURE, JSON.stringify({ migration: process.env.MIGRATION_DATABASE_URL || null, password: process.env.APP_LOGIN_PASSWORD || null, database: process.env.DATABASE_URL, noDotenv: process.env.AQUA_NO_DOTENV })); process.exit(23);\n`, { mode: 0o755 });
    const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/e2e-parent-link-zero-js.ts"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 30000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CHILD_ENV_CAPTURE: output,
        MIGRATION_DATABASE_URL: "synthetic-admin-marker", APP_LOGIN_PASSWORD: "synthetic-password-marker",
        DATABASE_URL: "synthetic-app-marker", AQUA_NO_DOTENV: "1" },
    });
    expect(child.status).not.toBe(0);
    const captured = JSON.parse(readFileSync(output, "utf8")) as Record<string, string | null>;
    expect(captured).toEqual({ migration: null, password: null, database: "synthetic-app-marker", noDotenv: "1" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("does not pass privileged setup credentials to the parent-link server child", () => {
  const dir = mkdtempSync(join(tmpdir(), "aqua-e2e-server-child-"));
  try {
    const output = join(dir, "child.json");
    writeFileSync(join(dir, "pnpm"), `#!${process.execPath}\nif (process.argv.includes('build')) process.exit(0); require('node:fs').writeFileSync(process.env.CHILD_ENV_CAPTURE, JSON.stringify({ migration: process.env.MIGRATION_DATABASE_URL || null, password: process.env.APP_LOGIN_PASSWORD || null, database: process.env.DATABASE_URL, noDotenv: process.env.AQUA_NO_DOTENV })); process.exit(23);\n`, { mode: 0o755 });
    spawnSync(process.execPath, ["--import", "tsx", "scripts/e2e-parent-link-zero-js.ts"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 3000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CHILD_ENV_CAPTURE: output,
        MIGRATION_DATABASE_URL: "synthetic-admin-marker", APP_LOGIN_PASSWORD: "synthetic-password-marker",
        DATABASE_URL: "synthetic-app-marker", AQUA_NO_DOTENV: "1" },
    });
    const captured = JSON.parse(readFileSync(output, "utf8")) as Record<string, string | null>;
    expect(captured).toEqual({ migration: null, password: null, database: "synthetic-app-marker", noDotenv: "1" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("routes every Next build and server spawn through the web environment boundary", () => {
  const files = ["parent-link-zero-js", "role-bypass", "host-boundary", "platform-form-leak", "offline", "offline-disabled", "login", "register"].map((name) => `scripts/e2e-${name}.ts`);
  files.push("tests/db/offline-privacy-driver.ts");
  let count = 0;
  for (const path of files) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["spawn", "execFileSync"].includes(node.expression.text)
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "pnpm"
        && node.arguments[1] && ts.isArrayLiteralExpression(node.arguments[1])
        && node.arguments[1].elements[0] && ts.isStringLiteral(node.arguments[1].elements[0]) && ["next", "dev"].includes(node.arguments[1].elements[0].text)) {
        count++;
        const options = node.arguments[2];
        expect(options && ts.isObjectLiteralExpression(options), path).toBe(true);
        if (!options || !ts.isObjectLiteralExpression(options)) return;
        const env = options.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(source) === "env");
        expect(env && ts.isPropertyAssignment(env) && ts.isCallExpression(env.initializer) && env.initializer.expression.getText(source) === "e2eWebEnv", path).toBe(true);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(count).toBe(11);
});
