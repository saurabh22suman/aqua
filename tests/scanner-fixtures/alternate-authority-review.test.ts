import { readFileSync, mkdtempSync, rmSync, mkdirSync, copyFileSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanLocationScope } from "@/scripts/lib/location-scope-scan";
import { REVIEWED_LOCATION_CONTRACTS } from "@/scripts/lib/location-scope-contracts";

const reviewedPaths = [
  "lib/services/guardian-authorization.ts",
  "lib/services/member-access-enrollment.ts",
  "lib/services/member-link-binding.ts",
  "lib/services/member-link-readmodel.ts",
  "lib/services/self-billing.ts",
  "lib/services/self-home.ts",
  "lib/services/showcase/publication-query.ts",
  "lib/services/showcase/subject.ts",
];

describe("reviewed alternate data-authority contracts", () => {
  it.each(reviewedPaths)("recognizes the exact reviewed source and authority graph: %s", (file) => {
    expect(scanLocationScope(readFileSync(file, "utf8"), file).violation).toBe(false);
  });
  it.each(reviewedPaths)("requires review after source drift: %s", (file) => {
    const changed = readFileSync(file, "utf8") + "\nexport function unscoped(tx: unknown) { resolveLocationAccess(tx); return tx.select().from(members); }\n";
    expect(scanLocationScope(changed, file).violation).toBe(true);
  });
  it.each(reviewedPaths)("does not transfer approval to a different path: %s", (file) => {
    expect(scanLocationScope(readFileSync(file, "utf8"), "lib/services/unreviewed-copy.ts").violation).toBe(true);
  });
  it.each(reviewedPaths)("fails closed without the reviewed authority dependencies: %s", (file) => {
    const root = mkdtempSync(join(tmpdir(), "khel-scope-missing-"));
    try { expect(scanLocationScope(readFileSync(file, "utf8"), file, root).violation).toBe(true); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
  it.each(reviewedPaths)("requires an intact contained dependency graph: %s", (file) => {
    const root = mkdtempSync(join(tmpdir(), "khel-scope-graph-"));
    try {
      const contract = REVIEWED_LOCATION_CONTRACTS[file]!;
      for (const path of [file, ...contract.dependencies]) {
        const destination = join(root, path);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(path, destination);
      }
      const source = readFileSync(file, "utf8");
      expect(scanLocationScope(source, file, root).violation).toBe(false);
      for (const dependency of contract.dependencies) {
        const dest = join(root, dependency);
        writeFileSync(dest, readFileSync(dependency, "utf8") + "\n// changed\n");
        expect(scanLocationScope(source, file, root).violation, `changed ${dependency}`).toBe(true);
        rmSync(dest);
        expect(scanLocationScope(source, file, root).violation, `missing ${dependency}`).toBe(true);
        symlinkSync(join(process.cwd(), dependency), dest);
        expect(scanLocationScope(source, file, root).violation, `escaping ${dependency}`).toBe(true);
        rmSync(dest);
        copyFileSync(dependency, dest);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
