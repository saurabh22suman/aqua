import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ captured: "", setup: [] as string[], setupHasAdmin: [] as boolean[] }));
vi.mock("playwright", () => ({ chromium: { launch: async () => ({ close: async () => {}, contexts: () => [] }) } }));
vi.mock("@testcontainers/postgresql", () => ({ PostgreSqlContainer: class {
  async start() { return this; }
  getHost() { return "127.0.0.1"; }
  getPort() { return 12345; }
  getDatabase() { return "synthetic"; }
  getConnectionUri() { return "synthetic-admin-marker"; }
  async stop() {}
} }));
vi.mock("pg", () => ({ Pool: class { async end() {} } }));
vi.mock("@/db/client", () => ({ pool: { end: async () => {} } }));
vi.mock("../../scripts/lib/offline-fixture", () => ({
  setupOfflineFixture: async () => ({ tenantId: "synthetic" }),
  setOfflineSyncEnabled: async () => {},
}));
vi.mock("node:child_process", async (load) => {
  const actual = await load<typeof import("node:child_process")>();
  return { ...actual,
    execFileSync: (_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      state.setup.push(args[0]!);
      state.setupHasAdmin.push(options.env.MIGRATION_DATABASE_URL === "synthetic-admin-marker" && options.env.APP_LOGIN_PASSWORD === "privacy-test");
    },
    spawn: (_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const result = actual.spawnSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify({migration: process.env.MIGRATION_DATABASE_URL || null, password: process.env.APP_LOGIN_PASSWORD || null, database: process.env.DATABASE_URL, noDotenv: process.env.AQUA_NO_DOTENV}))`], { env: options.env, encoding: "utf8" });
      state.captured = result.stdout;
      throw new Error("synthetic-stop-after-web-spawn");
    },
  };
});

it("keeps setup credentials in the parent but not the actual privacy-driver web child", async () => {
  const previous = { ...process.env };
  try {
    const { runOfflinePrivacy } = await import("@/tests/db/offline-privacy-driver");
    await expect(runOfflinePrivacy()).rejects.toThrow("synthetic-stop-after-web-spawn");
    expect(state.setup).toEqual(["db:deploy", "seed"]);
    expect(state.setupHasAdmin).toEqual([true, true]);
    expect(JSON.parse(state.captured)).toEqual({ migration: null, password: null,
      database: "postgresql://app_login:privacy-test@127.0.0.1:12345/synthetic", noDotenv: "1" });
  } finally {
    process.env = previous;
  }
});
