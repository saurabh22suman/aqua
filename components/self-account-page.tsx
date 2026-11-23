import Link from "next/link";
import { redirect } from "next/navigation";
import { SelfSignOut } from "@/components/self-sign-out";
import { SelfWorkspaceNav } from "@/components/self-workspace-nav";
import { WorkspaceRoleSwitch } from "@/components/settings/workspace-role-switch";
import { resolveSelfScope } from "@/lib/auth/self-scope";
import { readSelfWorkspaceRoles } from "@/lib/auth/workspace-roles";
import { NotFoundError } from "@/lib/auth/context";

export async function SelfAccountPage({ audience }: { audience: "member" | "guardian" }) {
  const home = audience === "guardian" ? "/family" : "/member";
  const resolver = await resolveSelfScope(audience, null);
  if (!resolver) redirect(`${home}/sign-in`);

  const identity = await resolver.read(async (_tx, scope) => ({
    tenantId: scope.tenantId,
    showAnnouncements: scope.kind === "self_session",
  })).catch((error: unknown) => {
    if (error instanceof NotFoundError) redirect(`${home}/sign-in`);
    throw error;
  });
  const roles = await readSelfWorkspaceRoles(resolver).catch(() => undefined);

  return (
    <main className="self-page">
      <div className="self-main">
        <SelfWorkspaceNav home={home} current="account" showAnnouncements={identity.showAnnouncements} />
        <h1 className="text-2xl font-bold">Account</h1>
        <section className="self-card space-y-3 p-4" aria-label="Account actions">
          <WorkspaceRoleSwitch options={roles} settingsHref={`${home}/account`} />
          <nav className="self-shortcuts" aria-label="Device">
            <Link prefetch={false} href={`/clubs/${identity.tenantId}/install?source=${identity.showAnnouncements ? audience : "staff"}`}>
              Install this club
            </Link>
          </nav>
          <div className="self-signout"><SelfSignOut audience={audience} /></div>
        </section>
      </div>
    </main>
  );
}
