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

const envSchema = z.object({
  DATABASE_URL: postgresUrl,
  MIGRATION_DATABASE_URL: z.preprocess(emptyAsUndefined, postgresUrl.optional()),
  APP_LOGIN_PASSWORD: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
  NODE_ENV: parsed.data.NODE_ENV,
};
