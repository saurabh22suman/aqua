import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("lists removed paths and both sides of moved paths for protected-path review", () => {
  const workflow = readFileSync(".github/workflows/agent-protected-paths.yml", "utf8");
  const flags = workflow.match(/^\s*git diff (.*?) "\$BASE\.\.\.\$HEAD"/m)?.[1].split(/\s+/);
  if (!flags) throw new Error("Could not find the workflow's diff command.");

  const repo = mkdtempSync(join(tmpdir(), "protected-path-test-"));
  function git(...args: string[]) {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  }

  try {
    git("init", "-q");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Test fixture");
    mkdirSync(join(repo, "protected"));
    writeFileSync(join(repo, "protected", "removed.txt"), "Removed");
    writeFileSync(join(repo, "protected", "moved.txt"), "Moved");
    git("add", ".");
    git("commit", "--no-verify", "-qm", "Original paths");
    const base = git("rev-parse", "HEAD");
    rmSync(join(repo, "protected", "removed.txt"));
    renameSync(join(repo, "protected", "moved.txt"), join(repo, "moved.txt"));
    git("add", "-A");
    git("commit", "--no-verify", "-qm", "Changed paths");

    const changed = git("diff", ...flags, `${base}...HEAD`).split(/[\0\n]/).filter(Boolean);
    expect(changed.sort()).toEqual(["moved.txt", "protected/moved.txt", "protected/removed.txt"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
