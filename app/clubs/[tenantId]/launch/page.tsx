import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { isOpsHost } from "@/lib/ops-host";
import { readAuthorizedBrandingTarget } from "@/lib/services/branding-target";
import { readTargetManifestData } from "@/lib/services/branding-target-asset";
import { buttonClasses } from "@/components/ui/Button";
import { ClubEntryCard } from "../entry-card";

export const dynamic = "force-dynamic";

/** Launcher never changes a club cookie; all view choices are reauthorized. */
export default async function TenantLaunchPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const h = await headers();
  if (isOpsHost(h.get("host")) || !z.string().uuid().safeParse(tenantId).success) notFound();
  const [staff, member, guardian] = await Promise.all([
    readAuthorizedBrandingTarget(tenantId, "staff", (tx) => readTargetManifestData(tx, tenantId)),
    readAuthorizedBrandingTarget(tenantId, "member", (tx) => readTargetManifestData(tx, tenantId)),
    readAuthorizedBrandingTarget(tenantId, "guardian", (tx) => readTargetManifestData(tx, tenantId)),
  ]);
  const club = staff ?? member ?? guardian;
  const destinations = club
    ? [
        ...(staff ? [{ href: "/clubs", label: "Choose a staff club" }] : []),
        ...(member ? [{ href: "/member", label: "Open member view" }] : []),
        ...(guardian ? [{ href: "/family", label: "Open family view" }] : []),
      ]
    : [
        { href: "/login", label: "Staff sign in" },
        { href: `/member/sign-in?clubId=${tenantId}`, label: "Member sign in" },
        { href: `/family/sign-in?clubId=${tenantId}`, label: "Family sign in" },
      ];
  return (
    <ClubEntryCard title={club ? `Open ${club.name}` : "Open your club"}>
      <p className="text-sm leading-relaxed text-ink-2">
        {club
          ? destinations.length === 1 ? "Continue to your view." : "Choose the view you want to open."
          : "Your access could not be confirmed. Sign in to the correct view or ask your club for help."}
      </p>
      <nav aria-label="Club entry" className="mt-4">
        <ul className="grid gap-2">
          {destinations.map(({href, label}) => (
            <li key={href}>
              <Link href={href} className={buttonClasses({ variant: destinations.length === 1 ? "primary" : "secondary", className: "w-full justify-start" })}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </ClubEntryCard>
  );
}
