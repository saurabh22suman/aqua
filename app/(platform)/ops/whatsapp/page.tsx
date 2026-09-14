import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { mockMessagingEnabled } from "@/lib/messaging/provider";
import { listRecentMessages } from "@/db/platform-messages";
import { listTenants } from "@/db/platform-tenants";
import { WhatsAppMock } from "./whatsapp-mock";

// C-40a — the non-production WhatsApp mock. Not reachable in
// production: the env boot guard refuses WHATSAPP_PROVIDER=mock, the
// resolver refuses it a second time, and this page 404s unless the
// resolver says mock.

export default async function WhatsAppMockPage() {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");
  if (!mockMessagingEnabled()) notFound();

  const [messages, tenantsResult] = await Promise.all([
    listRecentMessages(50),
    listTenants({ limit: 200, offset: 0 }),
  ]);

  return (
    <div className="max-w-4xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link
          href="/ops"
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          Overview
        </Link>
        {" / "}
        whatsapp mock
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
        WhatsApp mock
      </h1>
      <p className="mt-1 text-[14px] text-ink-2">
        Non-production only. Sends and receives run through the real
        message services with a fake transport, so everything here is
        logged and metered like a real message. There is no delivery.
      </p>

      <div className="mt-6">
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
      </div>
    </div>
  );
}
