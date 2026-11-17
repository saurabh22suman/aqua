import type { NextRequest } from "next/server";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permission";
import { getOrCreateReceipt } from "@/lib/services/receipts";

const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };
const notFound = () => new Response("Not found", { status: 404, headers: privateHeaders });

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
    return notFound();
  }
  if (!hasPermission(ctx, "invoices.read")) {
    return notFound();
  }

  try {
    const { paymentId } = await params;
    const result = await getOrCreateReceipt(ctx, paymentId);
    if (!result.ok) {
      return notFound();
    }

    return new Response(new Uint8Array(result.pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(result.pdf.byteLength),
        "content-disposition": `inline; filename="${result.fileName}"`,
        ...privateHeaders,
      },
    });
  } catch {
    return new Response("Unable to provide the receipt.", { status: 500, headers: privateHeaders });
  }
}
