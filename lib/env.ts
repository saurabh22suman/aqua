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
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment configuration:\n${issues}\nCopy .env.example to .env and fill in every variable.`,
  );
}

export const env = {
  DATABASE_URL: parsed.data.DATABASE_URL,
  MIGRATION_DATABASE_URL:
    parsed.data.MIGRATION_DATABASE_URL ?? parsed.data.DATABASE_URL,
  APP_LOGIN_PASSWORD: parsed.data.APP_LOGIN_PASSWORD,
  BETTER_AUTH_SECRET: parsed.data.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: parsed.data.BETTER_AUTH_URL,
  NODE_ENV: parsed.data.NODE_ENV,
};
