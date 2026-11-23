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
import { buttonClasses } from "@/components/ui/Button";
import { ClubEntryCard } from "../entry-card";

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
  return (
    <ClubEntryCard title={`Install ${branding.name}`}>
      <TenantManifestLink tenantId={tenantId} source={source} />
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
        <li>Open your browser’s menu or share options.</li>
        <li>Choose <strong className="text-ink">Install app</strong> or <strong className="text-ink">Add to Home Screen</strong>.</li>
        <li>Check the club name and confirm. Stay signed in if your device needs to fetch the club icon.</li>
      </ol>
      <Link href={`/clubs/${tenantId}/launch`} className={buttonClasses({ variant: "primary", className: "mt-5 w-full sm:w-auto" })}>
        Continue to your club
      </Link>
    </ClubEntryCard>
  );
}
