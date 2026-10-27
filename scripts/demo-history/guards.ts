// The refusals.
//
// This tool writes synthetic history into a real database. The guards
// are the difference between "the operator asked for a demo history" and
// "an env var was misconfigured and a live club received three thousand
// fake invoices". Each guard is a hard failure with a message that says
// what to do next.
//
// The guards are deliberately NOT keyed on the runtime's demo flag.
// That flag belongs to the runtime banner and the demo seed; this tool
// has its own, stricter opt-in (an explicit environment variable plus an
// explicit --apply flag) and its own allowlist of demo tenants, so
// nothing here can be switched on by accident.

/**
 * The demo tenants this tool may write to: slug → the tenant name it
 * must still have. Both the slug and the name have to match, so a real
 * customer tenant that happens to reuse a demo slug is still refused.
 */
export const DEMO_TENANTS: Record<string, string> = {
  "demo-academy": "Aqua Worli",
  "kicks-academy": "Kicks Football Academy",
};

/** The environment variable that permits writing (dry runs need none). */
export const APPLY_ENV_VAR = "AQUA_DEMO_HISTORY_APPLY";

export function assertDemoTenant(tenant: { slug: string; name: string }): void {
  const expected = DEMO_TENANTS[tenant.slug];
  if (!expected) {
    throw new Error(
      `Refusing to seed history: "${tenant.slug}" is not a demo tenant. ` +
        `This tool only writes synthetic history for: ${Object.keys(DEMO_TENANTS).join(", ")}.`,
    );
  }
  if (tenant.name !== expected) {
    throw new Error(
      `Refusing to seed history: the demo tenant "${tenant.slug}" is named ` +
        `"${tenant.name}", expected "${expected}".`,
    );
  }
}

/**
 * The database must be local and must not be production. A remote host
 * is refused even when the URL looks like a demo: the demo tenant
 * allowlist above is the second line of defence, this is the first.
 */
export function assertLocalDatabase(url: string, nodeEnv?: string): void {
  if (nodeEnv === "production") {
    throw new Error("Refusing to seed history: NODE_ENV=production.");
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(
      "Refusing to seed history: the database URL could not be read.",
    );
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(
      `Refusing to seed history: ${host} is not a loopback database.`,
    );
  }
}

/**
 * Writing needs an explicit opt-in. A dry run is always allowed — it
 * writes nothing and prints what it would write.
 */
export function assertApplyApproved(
  env: Record<string, string | undefined>,
  apply: boolean,
): void {
  if (!apply) return;
  if (env[APPLY_ENV_VAR] !== "1") {
    throw new Error(
      `Refusing to write history: set ${APPLY_ENV_VAR}=1 to confirm this is a demo database.`,
    );
  }
}

/** The anchor date override, when the operator pins one. */
export function assertAnchorDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `Refusing to seed history: the anchor date must be yyyy-mm-dd, got "${value}".`,
    );
  }
  return value;
}
