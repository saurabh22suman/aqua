import { z } from "zod";
import { loadDotEnv } from "@/lib/load-env";
import { HOSTNAME_PATTERN } from "@/lib/ops-host";

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
    // The platform (ops) host — the sibling of the tenant apex that
    // serves ONLY /ops/*. It is not a subdomain of the apex any more
    // (aquaops.preprabbit.in beside aqua.preprabbit.in), so
    // the app cannot infer it and the operator names it. A bare
    // hostname only: no scheme, no port, no path.
    //
    // Optional here because a local checkout has no platform host
    // (the legacy `ops.` prefix still resolves there). The tracked
    // Dokploy Compose files require it, so a real deployment cannot
    // come up without it.
    OPS_HOST: z.preprocess(
      emptyAsUndefined,
      z
        .string()
        .max(253)
        .regex(HOSTNAME_PATTERN, "must be a bare hostname (no scheme, port or path)")
        .optional(),
    ),
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
    // C-40a — messaging provider selection. Optional at parse time:
    // lib/messaging/provider.ts resolves `mock` outside production and
    // `disabled` in production. Setting `mock` in production is refused
    // at boot (superRefine below) — no silent mocking of deliveries.
    WHATSAPP_PROVIDER: z.preprocess(
      emptyAsUndefined,
      z.enum(["mock", "capture", "cloud", "disabled"]).optional(),
    ),
    AQUA_DEPLOYMENT_STAGE: z.preprocess(emptyAsUndefined, z.enum(["development", "preview", "production"]).optional()),
    // Explicit hosted mock for a separate synthetic preview. Its origin is
    // operator configuration, never a recipient/form-controlled destination.
    WHATSAPP_CAPTURE_URL: z.preprocess(emptyAsUndefined, z.string().url().refine(value => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
      } catch { return false; }
    }, "Must be a bare HTTPS capture origin").optional()),
    WHATSAPP_CAPTURE_AUTH_HEADER: z.preprocess(emptyAsUndefined, z.enum(["authorization", "x-api-key"]).optional()),
    WHATSAPP_CAPTURE_AUTH_VALUE: z.preprocess(emptyAsUndefined, z.string().min(1).max(2048).refine(value => !/[\r\n]/.test(value)).optional()),
    // Optional local capture viewer for the non-production mock. Restrict
    // transport to loopback so this cannot target a real WhatsApp endpoint.
    WHATSAPP_MOCK_URL: z.preprocess(
      emptyAsUndefined,
      z.string().url().refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
            !url.username && !url.password && !url.search && !url.hash &&
            url.pathname === "/";
        } catch {
          return false;
        }
      }, "Must be an HTTP loopback origin, e.g. http://localhost:3000").optional(),
    ),
    WHATSAPP_MOCK_FROM: z.preprocess(
      emptyAsUndefined,
      z.string().regex(/^\+?[0-9]{5,20}$/).optional(),
    ),
    // E-03/E-06 — Cloudflare R2 (S3-compatible) object store. All four
    // are optional and the store is enabled exactly when all four are
    // set (lib/storage/object-store.ts::isObjectStoreEnabled): a partial
    // set leaves it disabled and putObject fails loudly, rather than
    // silently writing somewhere unexpected. Never logged.
    R2_ACCOUNT_ID: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    R2_ACCESS_KEY_ID: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    R2_SECRET_ACCESS_KEY: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    R2_BUCKET: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    // E-03 — HMAC-SHA256 key for the daily audit checkpoint digest.
    // Optional at parse time so the app boots without it; the checkpoint
    // job and verifier demand it at entry (requireCheckpointSecret), so
    // an unsigned checkpoint can never be written or silently accepted.
    AUDIT_CHECKPOINT_SECRET: z.preprocess(
      emptyAsUndefined,
      z.string().min(1).optional(),
    ),
    // SEED_SPLASH_CLUB — a deployment starts with an empty database,
    // which is right for a real club and useless for a demo. When
    // this is true, the deploy step seeds ONE synthetic club (Splash
    // Sports Club: owner, coach, receptionist, swimmers, a batch, a
    // priced plan and a subscription) so a pilot has something to
    // look at. See db/seed-splash-club.ts.
    //
    // Deliberately NOT DEMO_MODE: DEMO_MODE means "this process is a
    // local demo" and the app refuses to SERVE in production with it
    // set. This flag only switches on a seeder.
    //
    // SEED_SPLASH_CLUB_PIN is the PIN the seeded staff sign in with.
    // There is no default: a fixed credential on a publicly reachable
    // host is a credential everybody can use. The seeder refuses to
    // run without it.
    SEED_SPLASH_CLUB: z.preprocess(
      emptyAsUndefined,
      z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    ),
    // The PIN's shape (6-12 digits) is the SEEDER's rule, not the
    // boot's: this variable is only read by the one-shot deploy step,
    // and a boot-time rejection here would take the web and worker
    // down over a demo-data typo. The seeder refuses to seed and says
    // so, which fails that one step and nothing else.
    SEED_SPLASH_CLUB_PIN: z.preprocess(
      emptyAsUndefined,
      z.string().min(1).optional(),
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

    // The WhatsApp mock records messages in the database and pretends
    // they were delivered. Never in production, for the same reason as
    // DEMO_MODE: a misconfigured env var would silently turn every real
    // notification into a no-op.
    if (requireProductionVars && val.WHATSAPP_PROVIDER === "mock") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["WHATSAPP_PROVIDER"],
        message:
          "WHATSAPP_PROVIDER=mock is not permitted in production — the mock pretends to deliver. Refusing to boot.",
      });
    }
    if (val.WHATSAPP_PROVIDER === "capture" && (val.AQUA_DEPLOYMENT_STAGE !== "preview" || !val.WHATSAPP_CAPTURE_URL)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["WHATSAPP_PROVIDER"],
        message: "Hosted capture requires AQUA_DEPLOYMENT_STAGE=preview and WHATSAPP_CAPTURE_URL; never use it with real academy records." });
    }
  });

export type ParsedEnv = {
  DATABASE_URL: string;
  MIGRATION_DATABASE_URL?: string;
  APP_LOGIN_PASSWORD?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  OPS_HOST?: string;
  PARENT_LINK_SECRET?: string;
  OPS_EMAIL?: string;
  OPS_PASSWORD?: string;
  WHATSAPP_PROVIDER?: "mock" | "capture" | "cloud" | "disabled";
  AQUA_DEPLOYMENT_STAGE?: "development" | "preview" | "production";
  WHATSAPP_CAPTURE_URL?: string;
  WHATSAPP_CAPTURE_AUTH_HEADER?: "authorization" | "x-api-key";
  WHATSAPP_CAPTURE_AUTH_VALUE?: string;
  WHATSAPP_MOCK_URL?: string;
  WHATSAPP_MOCK_FROM?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  AUDIT_CHECKPOINT_SECRET?: string;
  SEED_SPLASH_CLUB: boolean;
  SEED_SPLASH_CLUB_PIN?: string;
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
  return parsed.data;
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
