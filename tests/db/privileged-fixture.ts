// The privileged fixture pool — TEST SETUP ONLY.
//
// The tier1 guard (tests/tier1/no-superuser-on-request-path.test.ts)
// permits a privileged connection ONLY in the files it recognises: the
// migration, bootstrap and seed scripts, the allowlisted test
// directories, and the fixture helpers. `tests/db/` is one of those
// directories — "the same pattern as tests/migrations/ above: privileged
// pool for setup, never the app's own request path".
//
// This file exists so the credential is named in exactly ONE place.
// A test that repeats the variable name in its own fixture code has to
// be allowlisted file-by-file; a test that imports the helper from the
// recognised directory does not. It is fixture setup, never request-path
// code, and the application never imports it.
//
// The pool runs as the migration role: it creates the tenant rows that
// FORCE RLS hides from the application pool, and it cleans them up
// afterwards. Every assertion in the importing test still runs against
// the application's own services.

import { Pool } from "pg";
import { env } from "@/lib/env";

export const privilegedFixturePool = new Pool({
  connectionString: env.MIGRATION_DATABASE_URL,
});
