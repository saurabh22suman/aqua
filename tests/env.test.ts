import { afterEach, describe, expect, it, vi } from "vitest";

async function loadEnv() {
  vi.resetModules();
  vi.stubEnv("AQUA_NO_DOTENV", "1");
  return import("@/lib/env");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lib/env", () => {
  it("exposes a valid DATABASE_URL", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://aqua:aqua@localhost:5432/aqua",
    );
    vi.stubEnv("MIGRATION_DATABASE_URL", "");

    const { env } = await loadEnv();
    expect(env.DATABASE_URL).toBe("postgresql://aqua:aqua@localhost:5432/aqua");
    expect(env.MIGRATION_DATABASE_URL).toBe(env.DATABASE_URL);
  });

  it("fails loudly and names every missing variable", async () => {
    vi.stubEnv("DATABASE_URL", undefined);

    await expect(loadEnv()).rejects.toThrow(/DATABASE_URL/);
  });

  it("rejects a non-Postgres connection string", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://aqua:aqua@localhost:3306/aqua");

    await expect(loadEnv()).rejects.toThrow(/Postgres connection string/);
  });
});
