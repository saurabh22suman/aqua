import { Client } from "pg";
import { env } from "@/lib/env";

function quotePassword(password: string): string {
  return `'${password.replace(/'/g, "''")}'`;
}

export async function bootstrapRoles(connectionString: string): Promise<void> {
  const password = env.APP_LOGIN_PASSWORD;
  if (!password || password.trim() === "") {
    throw new Error(
      "APP_LOGIN_PASSWORD is not set. Refusing to bootstrap app_login without a password.",
    );
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'app_user') then
          create role app_user nologin;
        end if;

        if not exists (select 1 from pg_roles where rolname = 'app_login') then
          create role app_login login noinherit;
        end if;
      end
      $$;
    `);

    await client.query(
      `alter role app_login login noinherit password ${quotePassword(password)}`,
    );

    await client.query("grant app_user to app_login");

    await client.query(`
      grant select, insert, update, delete
        on all tables in schema public
        to app_user;
    `);

    await client.query(`
      alter default privileges in schema public
        grant select, insert, update, delete on tables to app_user;
    `);

    await client.query(`
      grant usage, select
        on all sequences in schema public
        to app_user;
    `);

    await client.query(`
      alter default privileges in schema public
        grant usage, select on sequences to app_user;
    `);

    console.log("Roles bootstrapped: app_user (nologin), app_login (login, noinherit).");
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  await bootstrapRoles(env.MIGRATION_DATABASE_URL);
}

if (process.argv[1] && process.argv[1].endsWith("bootstrap-roles.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
