import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadEnv() {
  vi.resetModules();
  vi.stubEnv("AQUA_NO_DOTENV", "1");
  return import("@/lib/env");
}

// CI's job-level `env:` block (see .github/workflows/ci.yml) sets several
// of these ambiently for every step, including this test file's own
// process — APP_LOGIN_PASSWORD in particular. Without this, a test that
// only stubs DATABASE_URL still inherits CI's real APP_LOGIN_PASSWORD and
// trips the password-match check added for D2b, passing locally (nothing
// ambient) and failing only in CI. Neutralise the whole set every test,
// then let individual tests opt back in to whatever they're exercising.
beforeEach(() => {
  vi.stubEnv("MIGRATION_DATABASE_URL", "");
  vi.stubEnv("APP_LOGIN_PASSWORD", "");
  vi.stubEnv("BETTER_AUTH_SECRET", "");
  vi.stubEnv("BETTER_AUTH_URL", "");
  vi.stubEnv("NEXT_PHASE", "");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lib/env", () => {
  it("exposes a valid DATABASE_URL", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://aqua:aqua@localhost:5432/aqua",
    );

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

  it("requires BETTER_AUTH_SECRET in production — a missing secret took auth down entirely, not just a warning", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://app_login:pw@localhost:5432/aqua");
    vi.stubEnv("APP_LOGIN_PASSWORD", "pw");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.com");
    vi.stubEnv("BETTER_AUTH_SECRET", undefined);

    await expect(loadEnv()).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });

  it("requires BETTER_AUTH_URL in production — callbacks/redirects are unreliable without it", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://app_login:pw@localhost:5432/aqua");
    vi.stubEnv("APP_LOGIN_PASSWORD", "pw");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-real-secret");
    vi.stubEnv("BETTER_AUTH_URL", undefined);

    await expect(loadEnv()).rejects.toThrow(/BETTER_AUTH_URL/);
  });

  it("does not require BETTER_AUTH_SECRET/URL during `next build`'s production-build phase — nothing is serving traffic yet", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://app_login:pw@localhost:5432/aqua");
    vi.stubEnv("APP_LOGIN_PASSWORD", "pw");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("BETTER_AUTH_SECRET", undefined);
    vi.stubEnv("BETTER_AUTH_URL", undefined);

    const { env } = await loadEnv();
    expect(env.NODE_ENV).toBe("production");
  });

  it("does not require BETTER_AUTH_SECRET/URL outside production", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://app_login:pw@localhost:5432/aqua");
    vi.stubEnv("APP_LOGIN_PASSWORD", "pw");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BETTER_AUTH_SECRET", undefined);
    vi.stubEnv("BETTER_AUTH_URL", undefined);

    const { env } = await loadEnv();
    expect(env.NODE_ENV).toBe("test");
  });

  it("succeeds in production once both are set", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://app_login:pw@localhost:5432/aqua");
    vi.stubEnv("APP_LOGIN_PASSWORD", "pw");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-real-secret");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.com");

    const { env } = await loadEnv();
    expect(env.NODE_ENV).toBe("production");
  });

  it("rejects a DATABASE_URL password that doesn't match APP_LOGIN_PASSWORD", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://app_login:one-password@localhost:5432/aqua");
    vi.stubEnv("APP_LOGIN_PASSWORD", "a-different-password");

    await expect(loadEnv()).rejects.toThrow(/APP_LOGIN_PASSWORD.*DATABASE_URL|DATABASE_URL.*APP_LOGIN_PASSWORD/s);
  });

  it("accepts a DATABASE_URL password that matches APP_LOGIN_PASSWORD", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://app_login:matching-pw@localhost:5432/aqua");
    vi.stubEnv("APP_LOGIN_PASSWORD", "matching-pw");

    const { env } = await loadEnv();
    expect(env.DATABASE_URL).toContain("matching-pw");
  });

  it("skips the password-match check when APP_LOGIN_PASSWORD is unset (e.g. web/worker runtime)", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://app_login:whatever-pw@localhost:5432/aqua");
    vi.stubEnv("APP_LOGIN_PASSWORD", "");

    const { env } = await loadEnv();
    expect(env.APP_LOGIN_PASSWORD).toBeUndefined();
  });
});
