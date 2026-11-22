import { z } from "zod";
import { isOpsHost } from "@/lib/ops-host";
import { tenantInstallManifest } from "@/lib/offline/pwa-manifest";
import { readAuthorizedBrandingTarget } from "@/lib/services/branding-target";
import { readTargetManifestData } from "@/lib/services/branding-target-asset";

export const dynamic = "force-dynamic";
const responseHeaders = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const missing = () => new Response("Not found", { status: 404, headers: responseHeaders });

export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  const url = new URL(request.url), { tenantId } = await context.params;
  const sources = url.searchParams.getAll("source");
  const source = z.enum(["staff", "member", "guardian"]).safeParse(sources.length === 1 ? sources[0] : null);
  if (isOpsHost(url.host) || isOpsHost(request.headers.get("host")) || !z.string().uuid().safeParse(tenantId).success || !source.success) return missing();
  const data = await readAuthorizedBrandingTarget(tenantId, source.data, (tx) => readTargetManifestData(tx, tenantId));
  const manifest = data && tenantInstallManifest({ tenantId, source: source.data, ...data });
  return manifest ? new Response(JSON.stringify(manifest), { headers: { ...responseHeaders, "content-type": "application/manifest+json" } }) : missing();
}
