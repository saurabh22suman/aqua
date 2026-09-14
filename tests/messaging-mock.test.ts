import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId } from "@/lib/ids";

// C-40a — the send/inbound paths against a real database: the mock is
// metered like a real provider, inbound lands through the same handler
// the webhook will call, and the log is tenant-isolated.

let container: StartedPostgreSqlContainer;
let admin: Pool;

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const RUN = Date.now().toString(36);

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'WA A', 'active'), ($3, $4, 'WA B', 'active')",
    [tenantA, `wa-a-${RUN}`, tenantB, `wa-b-${RUN}`],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("messaging mock pipeline", () => {
  it("sends through the resolved mock and writes a metered outbound row", async () => {
    const { sendMessage } = await import("@/lib/messaging/send");
    const result = await sendMessage({
      tenantId: tenantA,
      toPhone: "+919800000001",
      body: "Fee reminder for September",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { rows } = await admin.query<{
      direction: string;
      provider: string;
      provider_message_id: string;
      to_phone: string;
      body: string;
      status: string;
      category: string;
      cost_paise: string;
    }>("select * from message_log where id = $1", [result.messageId]);
    expect(rows[0]).toMatchObject({
      direction: "outbound",
      provider: "mock",
      to_phone: "+919800000001",
      body: "Fee reminder for September",
      status: "sent",
      category: "utility",
    });
    expect(rows[0].provider_message_id).toMatch(/^mock-/);
    expect(rows[0].cost_paise).toBe("12");
  });

  it("meters marketing at the higher estimate", async () => {
    const { sendMessage } = await import("@/lib/messaging/send");
    const result = await sendMessage({
      tenantId: tenantA,
      toPhone: "+919800000001",
      body: "Diwali camp offer",
      category: "marketing",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { rows } = await admin.query<{ cost_paise: string }>(
      "select cost_paise from message_log where id = $1",
      [result.messageId],
    );
    expect(rows[0].cost_paise).toBe("90");
  });

  it("fails closed when there is no provider", async () => {
    const { sendMessage } = await import("@/lib/messaging/send");
    const result = await sendMessage({
      tenantId: tenantA,
      toPhone: "+919800000001",
      body: "hello",
      provider: null,
    });
    expect(result.ok).toBe(false);

    const count = await admin.query<{ n: string }>(
      "select count(*)::text as n from message_log where tenant_id = $1 and body = 'hello'",
      [tenantA],
    );
    expect(count.rows[0].n).toBe("0");
  });

  it("writes a failed row and reports the error when the provider throws", async () => {
    const { sendMessage } = await import("@/lib/messaging/send");
    const result = await sendMessage({
      tenantId: tenantA,
      toPhone: "+919800000001",
      body: "will fail",
      provider: {
        name: "mock",
        async send() {
          throw new Error("transport down");
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const { rows } = await admin.query<{ status: string; cost_paise: string; error: string }>(
      "select status, cost_paise, error from message_log where body = 'will fail'",
    );
    expect(rows[0]).toMatchObject({ status: "failed", cost_paise: "0" });
    expect(rows[0].error).toContain("transport down");
  });

  it("records inbound messages through the shared handler", async () => {
    const { handleInboundMessage } = await import("@/lib/messaging/inbound");
    const result = await handleInboundMessage({
      tenantId: tenantA,
      fromPhone: "+919800000002",
      body: "Please confirm my daughter's class",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { rows } = await admin.query<{
      direction: string;
      status: string;
      from_phone: string;
      cost_paise: string;
    }>("select direction, status, from_phone, cost_paise from message_log where id = $1", [
      result.messageId,
    ]);
    expect(rows[0]).toMatchObject({
      direction: "inbound",
      status: "received",
      from_phone: "+919800000002",
      cost_paise: "0",
    });
  });

  it("lists recent messages for ops with the tenant name", async () => {
    const { listRecentMessages } = await import("@/db/platform-messages");
    const rows = await listRecentMessages(10);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows[0]!.tenantName).toBe("WA A");
    expect(rows.some((r) => r.direction === "inbound")).toBe(true);
  });

  it("keeps the log tenant-isolated under RLS", async () => {
    const { withTenant } = await import("@/db/tenant");
    const { messageLog } = await import("@/db/schema/message-log");
    const rowsForB = await withTenant(tenantB, (tx) =>
      tx.select().from(messageLog),
    );
    expect(rowsForB).toHaveLength(0);

    const rowsForA = await withTenant(tenantA, (tx) =>
      tx.select().from(messageLog),
    );
    expect(rowsForA.length).toBeGreaterThan(0);
  });
});
