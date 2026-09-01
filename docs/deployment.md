# Deployment

**Status: partial.** This file currently holds only the go-live checklist
items that came out of the D2 production-readiness audit. The full
Dokploy setup (app configuration, environment variables per service, the
migration step, Postgres hosting decision, backups, domain/TLS, rollback)
is D4 and lands in a later pass — don't treat this as complete.

## Go-live checklist

Run these once, against the actual production Postgres and the actual
production domain, before the pilot starts. Neither can be verified in
advance — they depend on infrastructure that doesn't exist until D4 is
built.

- [ ] **Role privileges on the real database.** `db/bootstrap-roles.ts`
      creates `app_user`/`app_login` without `SUPERUSER`/`BYPASSRLS` by
      construction — Postgres defaults new roles to neither — but that's
      only ever been exercised against local/CI Postgres. Some managed
      Postgres providers hand you a superuser-equivalent role by default;
      `bootstrap-roles.ts` running successfully doesn't prove the
      resulting roles are unprivileged if something upstream granted
      `app_user` more than this script asked for. After running
      `bootstrap-roles.ts` against production, run
      `docs/review-checklist.md` §4's query directly against that
      database and confirm `rolbypassrls = false` for both roles:

      ```sql
      select rolname, rolinherit, rolbypassrls, rolcanlogin
      from pg_roles
      where rolname in ('app_user', 'app_login');
      ```

- [ ] **Session cookie `Secure` flag under real TLS.** Confirmed locally
      over plain HTTP that better-auth sets `Set-Cookie: ...; HttpOnly;
      SameSite=Lax` with no `Secure` flag — expected over HTTP, but not
      verified over HTTPS. Once the production domain and TLS termination
      exist (D4), inspect a real `Set-Cookie` response header and confirm
      `Secure` is present. Don't assume better-auth adds it automatically
      just because the origin is HTTPS — check the actual header.
