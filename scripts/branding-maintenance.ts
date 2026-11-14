import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { constants } from "node:fs";
import { importLegacyAsset, inventoryBranding, type BoundedSource, type BrandingKind } from "./branding-maintenance-core";

// Caller supplies a private, operator-prepared directory, not web's R2 credentials.
// Never follow paths outside that directory or buffer more than the supplied limit.
export function directorySource(directory: string): BoundedSource {
  return { async read(key, limit) {
    const root = await realpath(directory);
    const candidate = await realpath(resolve(root, key));
    const rel = relative(root, candidate);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
    const file = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      // Linux descriptor resolution is checked before reading. If /proc is
      // unavailable, realpath throws and the caller fails closed.
      const opened = await realpath(`/proc/self/fd/${file.fd}`);
      const openedRel = relative(root, opened);
      if (!openedRel || openedRel === ".." || openedRel.startsWith(`..${sep}`) || isAbsolute(openedRel)) return null;
      const stat = await file.stat();
      if (!stat.isFile() || stat.size <= 0 || stat.size > limit) return null;
      const data = Buffer.alloc(limit + 1);
      let offset = 0;
      while (offset < data.length) {
        const result = await file.read(data, offset, data.length - offset, null);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      return offset > limit ? null : data.subarray(0, offset);
    } finally { await file.close(); }
  } };
}

export async function main(args: string[]): Promise<number> {
  const match = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 && args.indexOf(name, index + 1) < 0 ? args[index + 1] : undefined;
  };
  const tenant = match("--tenant");
  const importing = args.includes("--import");
  const kind = match("--kind");
  const directory = match("--source-dir");
  const allowed = importing ? ["--import", "--tenant", tenant, "--kind", kind, "--source-dir", directory] : ["--tenant", tenant];
  if (!tenant || args.length !== allowed.length || args.some((arg) => !allowed.includes(arg)) ||
      (importing && (!directory || (kind !== "logo" && kind !== "install_icon")))) {
    console.error("Usage: branding-maintenance --tenant UUID [--import --kind logo|install_icon --source-dir DIRECTORY]");
    return 2;
  }
  try {
    if (importing) {
      const result = await importLegacyAsset(tenant, kind as BrandingKind, directorySource(directory!));
      console.log(`import: ${result}`);
      if (result === "refused") return 1;
    }
    const status = await inventoryBranding(tenant);
    console.log(JSON.stringify(status));
    return Object.values(status).every((state) => state === "ready" || state === "absent") ? 0 : 1;
  } catch {
    console.error("Branding maintenance failed safely.");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(async (code) => {
    const { pool } = await import("@/db/client");
    await pool.end();
    process.exitCode = code;
  });
}
