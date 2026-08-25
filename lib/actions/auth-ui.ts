"use server";

import { headers } from "next/headers";
import { Pool } from "pg";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";
import { resolveHomePath } from "@/db/platform";


export async function homeForSessionAction(): Promise<string | null> {
  const h = await headers();
  const session = await withPlatform(() => auth.api.getSession({ headers: h }));
  if (!session?.user) return null;
  return resolveHomePath(session.user.id);
}

export async function devCodeAction(phone: string): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return null;

  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  try {
    const result = await pool.query<{ code: string }>(
      `select split_part(value, ':', 1) as code
       from ba_verification
       where identifier = $1 and expires_at > now()
       order by created_at desc
       limit 1`,
      [phone],
    );
    return result.rows[0]?.code ?? null;
  } finally {
    await pool.end();
  }
}
