import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TenantManifestLink } from "@/components/pwa/manifest-link";
import { isOpsHost } from "@/lib/ops-host";
import { readAuthorizedBrandingTarget } from "@/lib/services/branding-target";
import { readTargetManifestData } from "@/lib/services/branding-target-asset";
import { PWA_ICONS, tenantInstallManifest } from "@/lib/offline/pwa-manifest";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

type InstallProps = {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
};

async function authorizedInstall({ params, searchParams }: InstallProps) {
  const { tenantId } = await params, { source: rawSource } = await searchParams;
  const source = z.enum(["staff", "member", "guardian"]).safeParse(rawSource);
  const h = await headers();
  if (isOpsHost(h.get("host")) || !z.string().uuid().safeParse(tenantId).success || !source.success) notFound();
  const branding = await readAuthorizedBrandingTarget(tenantId, source.data, (tx) => readTargetManifestData(tx, tenantId));
  if (!branding) notFound();
  const manifest = tenantInstallManifest({ tenantId, source: source.data, ...branding });
  if (!manifest) notFound();
  return { tenantId, source: source.data, branding, manifest };
}

export async function generateMetadata(props: InstallProps): Promise<Metadata> {
  const { branding, manifest } = await authorizedInstall(props);
  const appleIcon = branding.iconDigest ? manifest.icons?.find((icon) => icon.sizes === "192x192")?.src : PWA_ICONS.appleTouch;
  if (!appleIcon || !manifest.name || !manifest.short_name) notFound();
  return { title: { absolute: manifest.name }, appleWebApp: { capable: true, title: manifest.short_name, statusBarStyle: "default" }, icons: { apple: appleIcon } };
}

export default async function TenantInstallPage(props: InstallProps) {
  const { tenantId, source, branding } = await authorizedInstall(props);
  return <main className="mx-auto min-h-dvh max-w-xl px-4 py-8">
    <TenantManifestLink tenantId={tenantId} source={source} />
    <h1 className="font-display text-2xl font-semibold text-ink">Install {branding.name}</h1>
    <p className="mt-4 text-base text-ink-2">Use your browser’s install or add-to-home-screen option for this club. Your browser or device may require you to remain signed in to retrieve its private icon.</p>
    <Link href={`/clubs/${tenantId}/launch`} className="mt-6 inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Continue to your club</Link>
  </main>;
}
