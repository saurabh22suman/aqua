import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";

export const pool = new Pool({ connectionString: env.DATABASE_URL });

pool.on("connect", (client) => {
  return client.query("set role app_user");
});

export const db = drizzle(pool);
