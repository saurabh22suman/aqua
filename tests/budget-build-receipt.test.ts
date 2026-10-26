import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { recordBudgetBuild, requireBudgetBuild } from "../scripts/lib/budget-build-receipt";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "aqua-budget-")); roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), ".next/\nbin/\nbuild-called\n");
  writeFileSync(join(root, "source.ts"), "export const value = 1;");
  mkdirSync(join(root, ".next/static/media"), { recursive: true });
  for (const name of ["BUILD_ID", "build-manifest.json", "app-build-manifest.json"]) writeFileSync(join(root, ".next", name), name);
  writeFileSync(join(root, ".next/static/media/font.woff2"), Buffer.alloc(100));
  return root;
}
function font(root: string, args: string[] = []) {
  return execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/check-font-budget.ts"), ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` }, stdio: "pipe",
  });
}
describe("budget build reuse", () => {
  it("accepts the exact successful build and checks its fonts without rebuilding", () => {
    const root = fixture(); recordBudgetBuild(root);
    expect(() => requireBudgetBuild(root)).not.toThrow();
    expect(font(root, ["--reuse-build"])).toContain("Within budget (1 files)");
  });
  it("fails closed without a receipt", () => {
    const root = fixture(); expect(() => font(root, ["--reuse-build"])).toThrow();
  });
  it.each(["source.ts", ".next/BUILD_ID", ".next/build-manifest.json", ".next/static/media/font.woff2"])("rejects changed %s", (name) => {
    const root = fixture(); recordBudgetBuild(root); writeFileSync(join(root, name), "changed");
    expect(() => requireBudgetBuild(root)).toThrow("receipt mismatch");
  });
  it("rejects newly added source files and missing artifacts", () => {
    const root = fixture(); recordBudgetBuild(root); writeFileSync(join(root, "new.ts"), "new");
    expect(() => requireBudgetBuild(root)).toThrow("receipt mismatch");
    rmSync(join(root, "new.ts")); rmSync(join(root, ".next/BUILD_ID"));
    expect(() => requireBudgetBuild(root)).toThrow();
  });
  it("still applies the font limit to a valid receipt", () => {
    const root = fixture(); writeFileSync(join(root, ".next/static/media/font.woff2"), Buffer.alloc(61 * 1024)); recordBudgetBuild(root);
    expect(() => font(root, ["--reuse-build"])).toThrow();
  });
  it("keeps standalone default building and rejects unknown flags", () => {
    const root = fixture(); mkdirSync(join(root, "bin"));
    const pnpm = join(root, "bin/pnpm"); writeFileSync(pnpm, '#!/bin/sh\nprintf "%s" "$*" > build-called\n'); chmodSync(pnpm, 0o755);
    expect(font(root)).toContain("Within budget");
    expect(readFileSync(join(root, "build-called"), "utf8")).toBe("exec next build");
    expect(() => font(root, ["--typo"])).toThrow();
  });
});
