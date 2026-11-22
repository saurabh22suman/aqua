// Empty values also prevent Next's own dotenv loader from restoring secrets
// from a local env file. The parent retains its setup credentials.
export function e2eWebEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, MIGRATION_DATABASE_URL: "", APP_LOGIN_PASSWORD: "" };
}
