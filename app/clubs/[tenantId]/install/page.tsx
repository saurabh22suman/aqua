import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TenantManifestLink } from "@/components/pwa/manifest-link";
import { isOpsHost } from "@/lib/ops-host";
import { readAuthorizedBrandingTarget } from "@/lib/services/branding-target";
import { readTargetManifestData } from "@/lib/services/branding-target-asset";

export const dynamic = "force-dynamic";

export default async function TenantInstallPage({ params, searchParams }: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
}) {
  const { tenantId } = await params, { source: rawSource } = await searchParams;
  const source = z.enum(["staff", "member", "guardian"]).safeParse(rawSource);
  const h = await headers();
  if (isOpsHost(h.get("host")) || !z.string().uuid().safeParse(tenantId).success || !source.success) notFound();
  const branding = await readAuthorizedBrandingTarget(tenantId, source.data, (tx) => readTargetManifestData(tx, tenantId));
  if (!branding) notFound();
  return <main className="mx-auto min-h-dvh max-w-xl px-4 py-8">
    <TenantManifestLink tenantId={tenantId} source={source.data} />
    <h1 className="font-display text-2xl font-semibold text-ink">Install {branding.name}</h1>
    <p className="mt-4 text-base text-ink-2">Use your browser’s install or add-to-home-screen option for this club. Your browser or device may require you to remain signed in to retrieve its private icon.</p>
    <Link href={`/clubs/${tenantId}/launch`} className="mt-6 inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Continue to your club</Link>
  </main>;
}
