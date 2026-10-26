import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  listOutOfTreeSymlinks,
  listServiceFiles,
  scanLocationScope,
} from "@/scripts/lib/location-scope-scan";

// Batch 4 — the location-scope scan's recursion blind spot.
//
// `listServiceFiles` used to be a flat `readdirSync` of lib/services, so
// any service file in a SUBDIRECTORY was invisible to the scan: it
// could query a location-bearing table without the location-access
// helper and CI would never see it. The first subdirectory in the tree
// (lib/services/mock-access) turned that from a theoretical gap into a
// live one.
//
// These are the positive controls for the traversal itself: a nested
// file must be listed, the listing must be deterministic, a symlink out
// of the tree must not be followed, and the real tree must be covered
// completely by the listing.

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// A tree with a service file at the top, one a level down, and one two
// levels down — plus a non-service file and a directory that is not a
// service file.
function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), "aqua-location-scope-"));
  roots.push(root);
  const services = join(root, "lib", "services");
  mkdirSync(join(services, "nested", "deeper"), { recursive: true });
  mkdirSync(join(services, "not-a-service"), { recursive: true });
  writeFileSync(join(services, "top.ts"), "export const top = 1;\n");
  writeFileSync(
    join(services, "nested", "inner.ts"),
    "export const inner = 1;\n",
  );
  writeFileSync(
    join(services, "nested", "deeper", "deepest.ts"),
    "export const deepest = 1;\n",
  );
  writeFileSync(join(services, "nested", "notes.md"), "not a service\n");
  writeFileSync(
    join(services, "not-a-service", "helper.txt"),
    "not a service\n",
  );
  return root;
}

describe("location-scope scan — nested service files", () => {
  it("lists a service file nested inside a subdirectory", () => {
    const files = listServiceFiles(makeTree());
    expect(files).toContain("lib/services/nested/inner.ts");
    expect(files).toContain("lib/services/nested/deeper/deepest.ts");
  });

  it("still lists the top-level service files", () => {
    const files = listServiceFiles(makeTree());
    expect(files).toContain("lib/services/top.ts");
  });

  it("does not list files that are not services", () => {
    const files = listServiceFiles(makeTree());
    expect(files).not.toContain("lib/services/nested/notes.md");
    expect(files).not.toContain("lib/services/not-a-service/helper.txt");
  });

  it("returns the listing in a deterministic order", () => {
    const root = makeTree();
    const first = listServiceFiles(root);
    const second = listServiceFiles(root);
    expect(first).toEqual(second);
    expect([...first].sort()).toEqual(first);
  });

  it("flags a nested service that queries members without the helper", () => {
    const root = makeTree();
    const nested = join(root, "lib", "services", "nested", "bad.ts");
    writeFileSync(
      nested,
      "export async function x(tx: any) { return tx.select().from(members); }\n",
    );
    const files = listServiceFiles(root);
    expect(files).toContain("lib/services/nested/bad.ts");
    const source = "export async function x(tx: any) { return tx.select().from(members); }\n";
    expect(
      scanLocationScope(source, "lib/services/nested/bad.ts").violation,
    ).toBe(true);
  });

  it("does not follow a symlink that points out of the tree", () => {
    const root = makeTree();
    const outside = mkdtempSync(join(tmpdir(), "aqua-location-outside-"));
    roots.push(outside);
    writeFileSync(
      join(outside, "escaped.ts"),
      "export async function x(tx: any) { return tx.select().from(members); }\n",
    );
    symlinkSync(join(outside, "escaped.ts"), join(root, "lib", "services", "escaped.ts"));

    const files = listServiceFiles(root);
    expect(files).not.toContain("lib/services/escaped.ts");
  });

  it("reports a symlink that points out of the tree instead of dropping it silently", () => {
    const root = makeTree();
    const outside = mkdtempSync(join(tmpdir(), "aqua-location-outside-"));
    roots.push(outside);
    writeFileSync(
      join(outside, "escaped.ts"),
      "export async function x(tx: any) { return tx.select().from(members); }\n",
    );
    symlinkSync(join(outside, "escaped.ts"), join(root, "lib", "services", "escaped.ts"));

    expect(listOutOfTreeSymlinks(root)).toContain("lib/services/escaped.ts");
  });

  it("fails loudly when there is no service tree to scan", () => {
    // A scan that scans nothing must not pass: that is how a blind
    // spot survives a rename or a moved directory.
    const root = mkdtempSync(join(tmpdir(), "aqua-location-empty-"));
    roots.push(root);
    expect(() => listServiceFiles(root)).toThrow(/nothing to scan/);
  });

  it("covers every service file in the real tree", () => {
    // An independent walk of the real tree: the scanner must not see
    // fewer files than a plain recursive listing does. The walk
    // descends into a DIRECTORY first and only then filters on the
    // .ts suffix — the order matters, and getting it wrong is the
    // bug this file exists to pin.
    const found = new Set(listServiceFiles());
    const expected = new Set<string>();
    const walk = (dir: string, prefix: string[]): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, [...prefix, entry.name]);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
        expected.add(["lib", "services", ...prefix, entry.name].join("/"));
      }
    };
    walk(join(process.cwd(), "lib", "services"), []);
    expect([...expected].filter((file) => !found.has(file))).toEqual([]);
  });
});
