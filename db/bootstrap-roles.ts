import { Client } from "pg";
import { env, requireMigrationUrl } from "@/lib/env";

function quotePassword(password: string): string {
  return `'${password.replace(/'/g, "''")}'`;
}

export async function bootstrapRoles(
  connectionString: string,
  password: string = env.APP_LOGIN_PASSWORD ?? "",
): Promise<void> {
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

    // Append-only tenant tables (E-05). The blanket GRANT above is
    // deliberately broad, and ALTER DEFAULT PRIVILEGES below re-applies
    // it to every table created by this role — which means a migration's
    // own REVOKE is undone the next time bootstrapRoles runs, and
    // db/deploy.ts re-bootstraps on every deploy. activity_events is
    // append-only for the app role: E-06 retention drops whole
    // partitions, the app never updates or deletes a row. Revoke after
    // the blanket grant so the guarantee survives re-bootstraps.
    // Partitions are included: "all tables" reaches them, and a REVOKE
    // on the parent does not cascade.
    const APPEND_ONLY_TENANT_TABLES = ["activity_events"];
    for (const table of APPEND_ONLY_TENANT_TABLES) {
      await client.query(`
        do $$
        declare
          part regclass;
        begin
          if to_regclass('public.${table}') is not null then
            revoke update, delete on public.${table} from app_user;
            for part in
              select inhrelid::regclass
                from pg_inherits
               where inhparent = 'public.${table}'::regclass
            loop
              execute format('revoke update, delete on %s from app_user', part);
            end loop;
          end if;
        end
        $$;
      `);
    }

    await client.query(`
      grant usage on schema public to app_user;
    `);

    await client.query(`
      grant usage on schema public to app_login;
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
  await bootstrapRoles(requireMigrationUrl("db/bootstrap-roles.ts"));
}

if (process.argv[1] && process.argv[1].endsWith("bootstrap-roles.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
