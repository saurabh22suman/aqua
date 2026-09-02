import { z } from "zod";
import { loadDotEnv } from "@/lib/load-env";

loadDotEnv();

function emptyAsUndefined(value: unknown): unknown {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const postgresUrl = z
  .string()
  .min(1)
  .refine(
    (v) => v.startsWith("postgres://") || v.startsWith("postgresql://"),
    "must be a Postgres connection string",
  );

function passwordOf(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).password);
}

const envSchema = z
  .object({
    DATABASE_URL: postgresUrl,
    MIGRATION_DATABASE_URL: z.preprocess(emptyAsUndefined, postgresUrl.optional()),
    APP_LOGIN_PASSWORD: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    BETTER_AUTH_SECRET: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    BETTER_AUTH_URL: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Demo gate. Defaults to false. When true:
    //  - `scripts/seed-demo.ts` and `scripts/seed-platform-user.ts` may
    //    run (otherwise they exit 1).
    //  - the `<DemoBanner />` renders on every surface.
    // Set to `true` ONLY on a developer machine running the demo. An
    // env var accidentally set in a real club's deployment must not
    // seed demo members into a real database — the production boot
    // guard below refuses to start if DEMO_MODE=true + NODE_ENV=production.
    DEMO_MODE: z.preprocess(
      emptyAsUndefined,
      z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    ),
  })
  .superRefine((val, ctx) => {
    // `next build` forces NODE_ENV=production for the child process that
    // collects page data, even though nothing is actually serving traffic
    // yet — Next sets NEXT_PHASE=phase-production-build for exactly this
    // case (see next/constants). Only the real production server phase
    // (or a plain node/tsx process with NODE_ENV=production, e.g. the
    // worker) should be held to the production requirements below.
    const isProductionBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
    const requireProductionVars = val.NODE_ENV === "production" && !isProductionBuildPhase;

    // A missing secret isn't a warning in production — better-auth fails
    // every single request. Fail at boot, not at the first login attempt.
    if (requireProductionVars && !val.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_SECRET"],
        message:
          "required in production — without it, better-auth throws on every request (confirmed: send-otp returns 500)",
      });
    }
    if (requireProductionVars && !val.BETTER_AUTH_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_URL"],
        message:
          "required in production — must be the real public HTTPS origin, or callbacks/redirects may not work correctly",
      });
    }

    // app_login's password is set twice, independently: once inside
    // DATABASE_URL (what the app connects with) and once in
    // APP_LOGIN_PASSWORD (what bootstrap-roles.ts sets the role's
    // password to). Nothing else keeps these in sync — a drift here
    // surfaces at boot as a bare Postgres auth failure with no
    // indication why.
    if (val.APP_LOGIN_PASSWORD) {
      const dbPassword = passwordOf(val.DATABASE_URL);
      if (dbPassword !== val.APP_LOGIN_PASSWORD) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["APP_LOGIN_PASSWORD"],
          message:
            "does not match the password embedded in DATABASE_URL — app_login would be bootstrapped with one password and connected to with another",
        });
      }
    }

    // DEMO_MODE in production (server phase only — `next build` is
    // exempt for the same reason BETTER_AUTH_SECRET is exempt above:
    // a developer's .env may legitimately have DEMO_MODE=true while
    // they're building). The point of the guard is to refuse to serve
    // a real club from a process that thinks demo seeding is allowed.
    if (val.DEMO_MODE && requireProductionVars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEMO_MODE"],
        message:
          "DEMO_MODE=true is not permitted in production — refusing to boot. An env var accidentally set in a real deployment would seed demo data into a real database.",
      });
    }
  });

export type ParsedEnv = {
  DATABASE_URL: string;
  MIGRATION_DATABASE_URL: string;
  APP_LOGIN_PASSWORD?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  NODE_ENV: "development" | "test" | "production";
  DEMO_MODE: boolean;
};

// Exported so tests can exercise the boot-fail combination without
// touching process.env. The module-level `env` below still runs the
// same parser at import time — production crashes on first import of
// lib/env when DEMO_MODE=true, which is the intended "refuse to boot".
export function parseEnv(raw: Record<string, string | undefined>): ParsedEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\nCopy .env.example to .env and fill in every variable.`,
    );
  }
  return {
    DATABASE_URL: parsed.data.DATABASE_URL,
    MIGRATION_DATABASE_URL:
      parsed.data.MIGRATION_DATABASE_URL ?? parsed.data.DATABASE_URL,
    APP_LOGIN_PASSWORD: parsed.data.APP_LOGIN_PASSWORD,
    BETTER_AUTH_SECRET: parsed.data.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: parsed.data.BETTER_AUTH_URL,
    NODE_ENV: parsed.data.NODE_ENV,
    DEMO_MODE: parsed.data.DEMO_MODE,
  };
}

export const env = parseEnv(process.env);