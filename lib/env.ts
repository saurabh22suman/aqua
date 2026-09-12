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
    // Optional at parse time on purpose: the worker MUST boot
    // without it (it must never hold the superuser credential —
    // deployment go-live check #3, and the compose file
    // deliberately withholds it). J7's fail-fast is preserved by
    // requireMigrationUrl() below, which every privileged script
    // calls at entry: a missing URL fails loudly in the script
    // that needs it, never silently, and never in a process that
    // must not have it.
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
    // C-45 parent-page link signing key. Same shape as BETTER_AUTH_SECRET
    // (HS256) but a separate secret so rotation doesn't invalidate parents'
    // active 7-day links when better-auth rotates its own. Required in
    // production for the same reason — the parent page is a live
    // surface, not a build-only one.
    PARENT_LINK_SECRET: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    // OPS_EMAIL + OPS_PASSWORD — the env-only operator login (see the
    // "2026-09-11 auth feature" plan). Both optional; both-or-neither
    // when set, enforced in superRefine below. The password's 12-char
    // minimum is mechanical: env vars leak through crash dumps and
    // process listings, so anything weaker belongs in dev tooling, not
    // a deployment. The email format check is so the comparison branch
    // in db/platform-auth.ts doesn't have to defend against "the env
    // literally wasn't an email" at request time.
    OPS_EMAIL: z.preprocess(
      emptyAsUndefined,
      z.string().email().optional(),
    ),
    OPS_PASSWORD: z.preprocess(
      emptyAsUndefined,
      z.string().min(12, "must be at least 12 characters").optional(),
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
    // Same rule for the parent-page link secret: the page renders live,
    // not at build time. A missing secret here would 500 every /p/[token]
    // request in production.
    if (requireProductionVars && !val.PARENT_LINK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PARENT_LINK_SECRET"],
        message:
          "required in production — without it, /p/[token] returns 500 on every render",
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

    // Ops env credentials are a single switch: set both to use the
    // env path, set neither to use the DB+TOTP path. Mixing them
    // (email set, password unset, or vice versa) is a misconfiguration
    // the operator would discover only on first login — fail fast at
    // boot instead.
    if ((val.OPS_EMAIL === undefined) !== (val.OPS_PASSWORD === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [val.OPS_EMAIL === undefined ? "OPS_EMAIL" : "OPS_PASSWORD"],
        message:
          val.OPS_EMAIL === undefined
            ? "OPS_EMAIL must be set when OPS_PASSWORD is set (both-or-neither — the env operator door is atomic)"
            : "OPS_PASSWORD must be set when OPS_EMAIL is set (both-or-neither — the env operator door is atomic)",
      });
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
  MIGRATION_DATABASE_URL?: string;
  APP_LOGIN_PASSWORD?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  PARENT_LINK_SECRET?: string;
  OPS_EMAIL?: string;
  OPS_PASSWORD?: string;
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
    MIGRATION_DATABASE_URL: parsed.data.MIGRATION_DATABASE_URL,
    APP_LOGIN_PASSWORD: parsed.data.APP_LOGIN_PASSWORD,
    BETTER_AUTH_SECRET: parsed.data.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: parsed.data.BETTER_AUTH_URL,
    PARENT_LINK_SECRET: parsed.data.PARENT_LINK_SECRET,
    OPS_EMAIL: parsed.data.OPS_EMAIL,
    OPS_PASSWORD: parsed.data.OPS_PASSWORD,
    NODE_ENV: parsed.data.NODE_ENV,
    DEMO_MODE: parsed.data.DEMO_MODE,
  };
}

// J7 fail-fast, relocated: MIGRATION_DATABASE_URL is optional at
// parse time (the worker boots without it), so every privileged
// script demands it explicitly at entry through here. Call with
// the script's name so the error says who needs it. Never fall
// back to DATABASE_URL — that runs migrations under `app_login`
// (no privileges) and surfaces as confusing errors, the exact
// shape J7 caught.
export function requireMigrationUrl(caller: string): string {
  const url = env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Invalid environment configuration:\n" +
        `  - MIGRATION_DATABASE_URL: required by ${caller} — connects as the privileged \`aqua\` role for migrations, role bootstrap, and pg-boss schema setup. Falling back to DATABASE_URL (which connects as \`app_login\`) would run privileged work under a role without the privileges it needs. Set MIGRATION_DATABASE_URL explicitly.`,
    );
  }
  return url;
}

export const env = parseEnv(process.env);