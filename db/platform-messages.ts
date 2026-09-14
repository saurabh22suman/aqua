import { desc, eq } from "drizzle-orm";
import { withPlatformAdmin } from "./scope";
import { messageLog } from "./schema/message-log";
import { tenants } from "./schema/tenants";

// C-40a — platform-side read for the non-production WhatsApp mock
// screen. It lists the tenant's messages alongside the tenant name so
// the operator can see what the mock actually recorded.

export type OpsMessageRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  direction: "outbound" | "inbound";
  provider: "mock" | "cloud";
  providerMessageId: string | null;
  toPhone: string | null;
  fromPhone: string | null;
  templateKey: string | null;
  body: string | null;
  status: string;
  category: string;
  costPaise: bigint;
  createdAt: string;
};

export async function listRecentMessages(
  limit = 50,
): Promise<OpsMessageRow[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return withPlatformAdmin(async (tx) => {
    const rows = await tx
      .select({ message: messageLog, tenantName: tenants.name })
      .from(messageLog)
      .innerJoin(tenants, eq(tenants.id, messageLog.tenantId))
      .orderBy(desc(messageLog.createdAt))
      .limit(safeLimit);
    return rows.map(({ message, tenantName }) => ({
      id: message.id,
      tenantId: message.tenantId,
      tenantName,
      direction: message.direction as "outbound" | "inbound",
      provider: message.provider as "mock" | "cloud",
      providerMessageId: message.providerMessageId,
      toPhone: message.toPhone,
      fromPhone: message.fromPhone,
      templateKey: message.templateKey,
      body: message.body,
      status: message.status,
      category: message.category,
      costPaise: message.costPaise,
      createdAt: message.createdAt.toISOString(),
    }));
  });
}
