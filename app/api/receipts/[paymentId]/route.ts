import type { NextRequest } from "next/server";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permission";
import { getOrCreateReceipt } from "@/lib/services/receipts";

// C-39 — serve a payment's receipt PDF. Session-gated and
// tenant-scoped, same contract as the payment-QR image route: the
// context comes from the better-auth session, the permission gate is
// invoices.read (reception holds it), and the service only returns
// rows of the caller's tenant. A missing or out-of-tenant payment is a
// 404 — same answer, no probing.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  let ctx;
  try {
    ctx = await requireDefaultCtx();
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!hasPermission(ctx, "invoices.read")) {
    return new Response("Not found", { status: 404 });
  }

  const { paymentId } = await params;
  const result = await getOrCreateReceipt(ctx, paymentId);
  if (!result.ok) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(result.pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(result.pdf.byteLength),
      "content-disposition": `inline; filename="${result.fileName}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
