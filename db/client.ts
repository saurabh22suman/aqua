import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type QueryConfig } from "pg";
import { env } from "@/lib/env";
import { currentScope } from "./scope";

function buildViolationSql(hint: unknown): string {
  const detail = String(hint).replace(/'/g, "''").slice(0, 200);
  return (
    "do $$ begin raise exception 'Unscoped query on the application pool. " +
    "An unscoped read returns ZERO ROWS, never an error - wrap tenant work in withTenant(), " +
    "platform work in withPlatform(). Offending statement: " +
    detail +
    "' using errcode='P0001'; end $$;"
  );
}

const SET_ROLE_SQL =
  /^\s*(begin|commit|rollback|set\b|select\s+set_config|select\s+1\b)/i;

function installScopeGuard(client: PoolClient): void {
  if (env.NODE_ENV === "production") return;
  const original = client.query.bind(client);
  client.query = ((...args: unknown[]) => {
    if (!currentScope()) {
      const first = args[0] as string | QueryConfig | undefined;
      const text =
        typeof first === "string" ? first : (first as QueryConfig | undefined)?.text ?? "";
      if (!SET_ROLE_SQL.test(text)) {
        args[0] = buildViolationSql(text);
        if (args[0] !== null && typeof args[0] === "object") {
          (args[0] as QueryConfig).text = buildViolationSql(text);
          (args[0] as QueryConfig).values = [];
        }
      }
    }
    return original(...(args as Parameters<PoolClient["query"]>));
  }) as PoolClient["query"];
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  onConnect: async (client) => {
    await client.query("set role app_user");
    installScopeGuard(client as PoolClient);
  },
});

export const db = drizzle(pool);
