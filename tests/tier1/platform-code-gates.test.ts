import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { currentTotpCode } from "@/db/platform-auth";

// Two pieces tested together: the helper exported by db/platform-auth
// (currentTotpCode — the mirror of verifyTotp that just generates
// instead of compares) and the demo-time script that uses it.
//
// The helper is small enough that the test is essentially "does
// the same RFC 6238 math as verifyTotp"; the script tests are
// gate checks (DEMO_MODE required, production refused, helpful
// error on no operator).

describe("currentTotpCode (RFC 6238 mirror of verifyTotp)", () => {
  // 32-char RFC 4648 base32, no padding. Decoded bytes = the
  // 20-byte secret used for the TOTP HMAC key. Same shape as
  // generateTotpSecret produces.
  const SAMPLE_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  it("produces a 6-digit zero-padded string", () => {
    // Fix the time so the result is deterministic.
    const code = currentTotpCode(SAMPLE_SECRET, 1700000000000);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("matches what verifyTotp would accept at the same timestamp", async () => {
    // Sanity: the generator must agree with the verifier, otherwise
    // scripts/platform-code.ts would print codes the login endpoint
    // rejects. Generate at five timestamps and check each one
    // round-trips through the verifier.
    // Import the verifier dynamically to keep the helper test
    // pure (no extra surface for the gate).
    const { verifyTotp } = await import("@/db/platform-auth");
    for (const t of [
      1700000000000,
      1717000000000,
      Date.parse("2026-09-07T09:00:00Z"),
      Date.parse("2026-09-07T09:00:15Z"),
      Date.parse("2026-09-07T09:00:31Z"),
    ]) {
      const code = currentTotpCode(SAMPLE_SECRET, t);
      expect(
        verifyTotp(SAMPLE_SECRET, code, t),
        `code=${code} at t=${t} must verify`,
      ).toBe(true);
    }
  });

  it("returns 000000 for a malformed secret rather than throwing", () => {
    // Used in scripts/platform-code.ts path lookup — a malformed
    // base32 should surface as "no code" (000000) rather than
    // crash the CLI. Defensive: the verify path throws on bad
    // input but the generate path shouldn't, since the only
    // caller is a CLI that prints one number.
    const code = currentTotpCode("not-valid-base32!!!", 1700000000000);
    expect(code).toBe("000000");
  });
});

describe("scripts/platform-code.ts gates (DEMO_MODE / production)", () => {
  it("refuses when DEMO_MODE is unset", () => {
    // The script reads env.DEMO_MODE through lib/env. We can't
    // unset DEMO_MODE directly here because the test process
    // inherits CI's ambient value — instead we invoke the script
    // via tsx with the env explicitly cleared. tsx imports lib/env
    // fresh on each invocation, so this is hermetic.
    expect(() => {
      execFileSync("npx", ["tsx", "scripts/platform-code.ts"], {
        env: { ...process.env, DEMO_MODE: "" },
        stdio: "pipe",
      });
    }).toThrow(/DEMO_MODE is not enabled/);
  });

  it("prints a current code when DEMO_MODE=true and NODE_ENV is not production", () => {
    // We need an enrolled platform operator in the DB to read the
    // secret from. The seed script is the easiest path: it runs in
    // ~1s on a warm DB and uses DEMO_MODE itself, so it's safe to
    // chain here.
    execFileSync("npx", ["tsx", "scripts/seed-platform-user.ts", "--email", "ops@aqua.local", "--name", "Default Operator"], {
      env: { ...process.env, DEMO_MODE: "true" },
      stdio: "pipe",
    });
    const out = execFileSync("npx", ["tsx", "scripts/platform-code.ts"], {
      env: { ...process.env, DEMO_MODE: "true", NODE_ENV: "test" },
      stdio: "pipe",
    }).toString();
    expect(out).toMatch(/^\d{6}\s+\(refresh in \d+s — email:/);
  }, 30_000);

  it("refuses when NODE_ENV=production even if DEMO_MODE=true (lib/env boot guard)", () => {
    // Production refusal is layered: lib/env.ts refuses to boot
    // when NODE_ENV=production + DEMO_MODE=true, so the script
    // never gets a chance to run its own check. We verify the
    // boot guard by importing the parser directly.
    expect(() =>
      import("@/lib/env").then((m) =>
        m.parseEnv({
          DATABASE_URL: "postgresql://app_login:pw@localhost:5432/aqua",
          MIGRATION_DATABASE_URL: "postgresql://aqua:aqua@localhost:5432/aqua",
          DEMO_MODE: "true",
          NODE_ENV: "production",
          APP_LOGIN_PASSWORD: "pw",
          BETTER_AUTH_SECRET: "x".repeat(32),
          BETTER_AUTH_URL: "https://example.com",
          PARENT_LINK_SECRET: "x".repeat(32),
        }),
      ),
    ).rejects.toThrow(/DEMO_MODE=true is not permitted in production/);
  });
});
