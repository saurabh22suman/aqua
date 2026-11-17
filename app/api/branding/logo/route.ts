import { requireDefaultCtx } from "@/lib/auth/context";
import { readBrandingLogo } from "@/lib/services/branding-asset-read";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const missing = () => new Response("Not found", { status: 404, headers });

export async function GET(request: Request): Promise<Response> {
  const digest = new URL(request.url).searchParams.get("v") ?? "";
  if (!/^[a-f0-9]{64}$/.test(digest)) return missing();
  try {
    const ctx = await requireDefaultCtx();
    const bytes = await readBrandingLogo(ctx, digest);
    if (!bytes) return missing();
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "content-type": "image/png" } });
  } catch {
    return missing();
  }
}
