import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RECEIPT = ".next/aqua-budget-build.json";

function digest(entries: [string, Buffer][]): string {
  const hash = createHash("sha256");
  for (const [name, bytes] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(JSON.stringify([name, bytes.length]));
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function snapshot(root: string) {
  // Include dirty and new source files, not just HEAD. Git's ignore rules
  // exclude generated build outputs, dependencies and local secrets.
  const names = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root, encoding: "utf8",
  }).split("\0").filter(Boolean);
  const source = digest([...new Set(names)].map((name) => [name, existsSync(join(root, name)) ? Buffer.concat([Buffer.from("present\0"), readFileSync(join(root, name))]) : Buffer.from("deleted\0")]));
  const media = join(root, ".next/static/media");
  const files = [".next/BUILD_ID", ".next/build-manifest.json", ".next/app-build-manifest.json",
    ...readdirSync(media).filter((name) => name.endsWith(".woff2")).map((name) => `.next/static/media/${name}`)];
  return {
    version: 1,
    source,
    artifact: digest(files.map((name) => [name, readFileSync(join(root, name))])),
    node: process.version,
    // Public build flags can affect emitted assets; never store their values.
    publicEnvironment: digest(Object.entries(process.env)
      .filter(([name]) => name.startsWith("NEXT_PUBLIC_"))
      .map(([name, value]) => [name, Buffer.from(value ?? "")])),
  };
}

/** Write only after both the production build and route budget have passed. */
export function recordBudgetBuild(root = process.cwd()): void {
  writeFileSync(join(root, RECEIPT), JSON.stringify(snapshot(root)));
}

/** Never fall back to an unverified stale .next directory. */
export function requireBudgetBuild(root = process.cwd()): void {
  const recorded: unknown = JSON.parse(readFileSync(join(root, RECEIPT), "utf8"));
  if (JSON.stringify(recorded) !== JSON.stringify(snapshot(root))) {
    throw new Error("Budget build receipt mismatch — run check:bundle again before --reuse-build");
  }
}
