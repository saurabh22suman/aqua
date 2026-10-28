import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { mockMessagingEnabled } from "@/lib/messaging/provider";
import { listRecentMessages } from "@/db/platform-messages";
import { listTenants } from "@/db/platform-tenants";
import { WhatsAppMock } from "./whatsapp-mock";
import { OpsPage, OpsPageHeader, OpsPanel } from "@/components/ops/ops-primitives";
import { OpsWriteGate } from "@/components/ops/ops-display";

// C-40a — the non-production WhatsApp mock. Not reachable in
// production: the env boot guard refuses WHATSAPP_PROVIDER=mock, the
// resolver refuses it a second time, and this page 404s unless the
// resolver says mock.
//
// Ops redesign (28 October 2026): the page says plainly what it is —
// a mock — and shows only what the platform actually holds. No
// provider integration is implied.
export default async function WhatsAppMockPage() {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");
  if (!mockMessagingEnabled()) notFound();
  const canWrite = status.role === "admin";

  const [messages, tenantsResult] = await Promise.all([
    listRecentMessages(50),
    listTenants({ limit: 200, offset: 0 }),
  ]);

  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Overview / whatsapp mock"
        title="WhatsApp mock"
        lede="Non-production only. Sends and receives run through the real message services with a fake transport, so everything here is logged and metered like a real message. There is no delivery."
      />
      <OpsPanel
        tone="warn"
        className="mt-5"
        title="This route 404s outside the mock provider"
      >
        The environment boot guard refuses <span className="font-mono">WHATSAPP_PROVIDER=mock</span>{" "}
        in production and the resolver refuses it again. No live WhatsApp
        account, BSP or gateway is involved here.
      </OpsPanel>

      <div className="mt-6">
        <OpsWriteGate
          canWrite={canWrite}
          note={
            <>
              Read-only: this account can browse, not change, platform data. The
              mock sends and receives messages for an administrator.
            </>
          }
        >
          <WhatsAppMock
            tenants={tenantsResult.rows.map((t) => ({ id: t.id, name: t.name }))}
            messages={messages.map((message) => ({
              id: message.id,
              tenantName: message.tenantName,
              direction: message.direction,
              provider: message.provider,
              toPhone: message.toPhone,
              fromPhone: message.fromPhone,
              body: message.body,
              status: message.status,
              category: message.category,
              costPaise: message.costPaise.toString(),
              createdAt: message.createdAt,
            }))}
          />
        </OpsWriteGate>
      </div>
    </OpsPage>
  );
}
