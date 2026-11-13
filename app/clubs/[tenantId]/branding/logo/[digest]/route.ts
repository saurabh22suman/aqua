import { z } from "zod";
import { isOpsHost } from "@/lib/ops-host";
import { readAuthorizedBrandingTarget } from "@/lib/services/branding-target";
import { readTargetLogo } from "@/lib/services/branding-target-asset";

export const dynamic = "force-dynamic";
const responseHeaders = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const missing = () => new Response("Not found", { status: 404, headers: responseHeaders });

export async function GET(request: Request, context: { params: Promise<{ tenantId: string; digest: string }> }): Promise<Response> {
  const url = new URL(request.url);
  const { tenantId, digest } = await context.params;
  const sources = url.searchParams.getAll("source");
  const source = z.enum(["staff", "member", "guardian"]).safeParse(sources.length === 1 ? sources[0] : null);
  if (isOpsHost(url.host) || isOpsHost(request.headers.get("host")) || !z.string().uuid().safeParse(tenantId).success || !/^[a-f0-9]{64}$/.test(digest) || !source.success) return missing();
  const bytes = await readAuthorizedBrandingTarget(tenantId, source.data, (tx) => readTargetLogo(tx, tenantId, digest));
  return bytes ? new Response(new Uint8Array(bytes), { headers: { ...responseHeaders, "content-type": "image/png" } }) : missing();
}
