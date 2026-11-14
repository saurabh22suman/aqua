import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { readBrandingLogo } from "@/lib/services/branding";
import { importLegacyAsset, inventoryBranding, preflightBranding } from "@/scripts/branding-maintenance-core";
import { directorySource, main } from "@/scripts/branding-maintenance";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

it("makes an existing valid legacy logo readable after a tenant-scoped maintenance import", async () => {
  const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#123456" } }).png().toBuffer();
  const sha256 = createHash("sha256").update(png).digest("hex");
  const objectKey = `tenant-branding/${f.tenantId}/logo/${sha256}.png`;
  await f.admin.query("update tenants set branding=$2 where id=$1", [f.tenantId, JSON.stringify({ logo: { objectKey, sha256, contentType: "image/png" } })]);
  expect(await importLegacyAsset(f.tenantId, "logo", { read: async () => png })).toBe("imported");
  expect(await readBrandingLogo({ tenantId: f.tenantId }, sha256)).toEqual(png);
  expect(await importLegacyAsset(f.tenantId, "logo", { read: async () => png })).toBe("already_present");
  expect(await preflightBranding(f.tenantId)).toBe(true);
});

it("reports malformed, missing and corrupt assets without attempting a write", async () => {
  const g = await fixture();
  try {
    await g.admin.query("update tenants set branding=$2 where id=$1", [g.tenantId, JSON.stringify({ logo: { bad: true } })]);
    expect((await inventoryBranding(g.tenantId)).logo).toBe("malformed");
    expect(await preflightBranding(g.tenantId)).toBe(false);
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try { expect(await main(["--tenant", g.tenantId])).toBe(1); } finally { output.mockRestore(); }
    expect(await importLegacyAsset(g.tenantId, "logo", { read: async () => null })).toBe("refused");
    const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#aabbcc" } }).png().toBuffer();
    const digest = createHash("sha256").update(png).digest("hex");
    const logo = { objectKey: `tenant-branding/${g.tenantId}/logo/${digest}.png`, sha256: digest, contentType: "image/png" };
    await g.admin.query("update tenants set branding=$2 where id=$1", [g.tenantId, JSON.stringify({ logo })]);
    expect((await inventoryBranding(g.tenantId)).logo).toBe("missing");
    expect(await importLegacyAsset(g.tenantId, "logo", { read: async () => Buffer.from("corrupt") })).toBe("refused");
    expect(await importLegacyAsset(g.tenantId, "logo", { read: async () => Buffer.alloc(5 * 1024 * 1024 + 1) })).toBe("refused");
    expect(await importLegacyAsset(g.tenantId, "logo", { read: async () => png })).toBe("imported");
    const other = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#000000" } }).png().toBuffer();
    await g.admin.query("update branding_assets set png=$2 where tenant_id=$1 and kind='logo'", [g.tenantId, other]);
    expect((await inventoryBranding(g.tenantId)).logo).toBe("invalid");
    expect(await preflightBranding(g.tenantId)).toBe(false);
    expect(await importLegacyAsset(g.tenantId, "logo", { read: async () => png })).toBe("refused");
  } finally { await g.cleanup(); }
});

it("refuses a stale legacy reference changed during the object read", async () => {
  const g = await fixture();
  try {
    const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#abcdef" } }).png().toBuffer();
    const sha256 = createHash("sha256").update(png).digest("hex");
    const logo = { objectKey: `tenant-branding/${g.tenantId}/logo/${sha256}.png`, sha256, contentType: "image/png" };
    await g.admin.query("update tenants set branding=$2 where id=$1", [g.tenantId, JSON.stringify({ logo })]);
    expect(await importLegacyAsset(g.tenantId, "logo", { read: async () => {
      await g.admin.query("update tenants set branding=$2 where id=$1", [g.tenantId, JSON.stringify({ logo: { bad: true } })]);
      return png;
    } })).toBe("refused");
    expect((await g.admin.query("select count(*)::int n from branding_assets where tenant_id=$1", [g.tenantId])).rows[0].n).toBe(0);
    expect((await g.admin.query("select branding from tenants where id=$1", [g.tenantId])).rows[0].branding.logo).toEqual({ bad: true });
  } finally { await g.cleanup(); }
});

it("rolls back imported bytes if the system audit insert fails", async () => {
  const g = await fixture();
  try {
    const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#abcdef" } }).png().toBuffer();
    const sha256 = createHash("sha256").update(png).digest("hex");
    const logo = { objectKey: `tenant-branding/${g.tenantId}/logo/${sha256}.png`, sha256, contentType: "image/png" };
    await g.admin.query("update tenants set branding=$2 where id=$1", [g.tenantId, JSON.stringify({ logo })]);
    await g.admin.query(`create function public.test_branding_import_audit_failure() returns trigger language plpgsql as $$ begin if new.tenant_id = '${g.tenantId}'::uuid and new.action = 'branding.asset.import' then raise exception 'synthetic audit failure'; end if; return new; end $$`);
    await g.admin.query("create trigger test_branding_import_audit_failure before insert on audit_log for each row execute function public.test_branding_import_audit_failure()");
    try {
      await expect(importLegacyAsset(g.tenantId, "logo", { read: async () => png })).rejects.toThrow();
      expect((await g.admin.query("select count(*)::int n from branding_assets where tenant_id=$1", [g.tenantId])).rows[0].n).toBe(0);
      expect((await g.admin.query("select branding from tenants where id=$1", [g.tenantId])).rows[0].branding.logo).toEqual(logo);
    } finally {
      await g.admin.query("drop trigger test_branding_import_audit_failure on audit_log");
      await g.admin.query("drop function public.test_branding_import_audit_failure()");
    }
  } finally { await g.cleanup(); }
});

it("runs the inventory and explicit directory import through the actual CLI", async () => {
  const g = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "branding-cli-")).catch(async (error: unknown) => { await g.cleanup(); throw error; });
  const path = join(directory, "tenant-branding", g.tenantId, "logo");
  const run = (args: string[]) => new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/branding-maintenance.ts", ...args], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
  const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#abcdef" } }).png().toBuffer();
  const sha256 = createHash("sha256").update(png).digest("hex");
  const filename = join(path, `${sha256}.png`);
  try {
    await mkdir(path, { recursive: true });
    await writeFile(filename, png);
    const logo = { objectKey: `tenant-branding/${g.tenantId}/logo/${sha256}.png`, sha256, contentType: "image/png" };
    await g.admin.query("update tenants set branding=$2 where id=$1", [g.tenantId, JSON.stringify({ logo })]);
    expect(await run(["--tenant", g.tenantId])).toBe(1);
    expect(await run(["--tenant", g.tenantId, "--import", "--kind", "logo", "--source-dir", directory])).toBe(0);
    expect(await run(["--tenant", g.tenantId])).toBe(0);
    expect(await readBrandingLogo({ tenantId: g.tenantId }, sha256)).toEqual(png);
  } finally {
    await rm(filename, { force: true });
    await rmdir(path);
    await rmdir(join(directory, "tenant-branding", g.tenantId));
    await rmdir(join(directory, "tenant-branding"));
    await rmdir(directory);
    await g.cleanup();
  }
}, 30000);

it("bounds directory reads and refuses traversal or escaping symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branding-source-"));
  const root = join(directory, "root");
  const outside = join(directory, "outside");
  await mkdir(root);
  try {
    await writeFile(outside, "outside");
    await writeFile(join(root, "ok"), "ok");
    await writeFile(join(root, "empty"), "");
    await writeFile(join(root, "large"), Buffer.alloc(17));
    execFileSync("mkfifo", [join(root, "fifo")]);
    await symlink(outside, join(root, "escape"));
    await symlink(directory, join(root, "parent-link"));
    const source = directorySource(root);
    expect(await source.read("ok", 16)).toEqual(Buffer.from("ok"));
    expect(await source.read("../outside", 16)).toBeNull();
    expect(await source.read("escape", 16)).toBeNull();
    expect(await source.read("parent-link/outside", 16)).toBeNull();
    expect(await source.read("empty", 16)).toBeNull();
    expect(await source.read("large", 16)).toBeNull();
    expect(await source.read("fifo", 16)).toBeNull();
  } finally {
    for (const name of ["ok", "empty", "large", "fifo", "escape", "parent-link"]) await rm(join(root, name), { force: true });
    await rm(outside, { force: true });
    await rmdir(root);
    await rmdir(directory);
  }
});
