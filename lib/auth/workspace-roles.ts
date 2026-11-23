import { headers } from "next/headers";
import { listClubChoices } from "@/db/club-selection";
import { resolveDefaultMembership } from "@/db/platform";
import { withPlatform } from "@/db/scope";
import { readSelfServiceAccountInTx } from "@/db/self-service-account";
import { withTenant, type TenantTx } from "@/db/tenant";
import { activeClubFromHeaders } from "@/lib/auth/active-club";
import { auth } from "@/lib/auth/server";
import { resolveScopedSelfScope, type SelfScopeResolver } from "@/lib/auth/self-scope";
import { NotFoundError, type Ctx } from "@/lib/auth/context";
import { isSessionExpiredForRole } from "@/lib/auth/permissions";
import type { TenantId, UserId } from "@/lib/ids";
import { readLinkFacts, readLiveLinkIds } from "@/lib/services/self-service-link-facts";
import { authorizeBoundLinks, validateOmittedGuardianLinks } from "@/lib/services/self-service-session";

type Audience = "member" | "guardian";

export type WorkspaceRoleOptions = {
  current: string;
  choices: { label: string; href: string; detail: string }[];
  showBusinessSwitch?: boolean;
};

const SELF_ROLES = {
  member: { label: "Member", path: "/member" },
  guardian: { label: "Family", path: "/family" },
} as const;

async function getStaffSession() {
  const h = await headers();
  const session = await withPlatform(() => auth.api.getSession({ headers: h }));
  return { session, selectedBusiness: activeClubFromHeaders(h) };
}

async function linkedRolesInTx(
  tx: TenantTx,
  identity: { tenantId: TenantId; userId: UserId },
  audiences: Audience[],
) {
  const account = await readSelfServiceAccountInTx(tx, identity);
  if (!account?.betterAuthId) return null;

  const roles: Audience[] = [];
  for (const audience of audiences) {
    const candidate = { ...identity, audience };
    const linkIds = await readLiveLinkIds(tx, candidate);
    if (!linkIds.length) continue;
    const facts = await readLinkFacts(tx, { ...candidate, linkIds });
    if (facts.length !== linkIds.length) continue;
    const omitted = audience === "guardian"
      ? facts.filter(fact => fact.childPersonSoftDeleted).map(fact => fact.linkId)
      : [];
    const verified = { ...candidate, accountPhone: account.phone };
    if (omitted.length && !await validateOmittedGuardianLinks(tx, { ...verified, linkIds: omitted })) continue;
    const eligible = facts.filter(fact => !omitted.includes(fact.linkId));
    const authorized = await authorizeBoundLinks(tx, {
      ...verified,
      linkIds: eligible.map(fact => fact.linkId),
      subjectId: audience === "member" ? eligible[0]?.memberId : null,
    });
    if (authorized.ok) roles.push(audience);
  }
  return { betterAuthId: account.betterAuthId, roles };
}

function roleChoice(audience: Audience, tenantId: TenantId, alreadySignedIn: boolean): WorkspaceRoleOptions["choices"][number] {
  const role = SELF_ROLES[audience];
  return {
    label: role.label,
    href: alreadySignedIn ? role.path : `${role.path}/sign-in?clubId=${tenantId}`,
    detail: alreadySignedIn ? "Open your workspace" : "Confirm with your PIN",
  };
}

/** The settings page supplies its authorized staff context for this request. */
export async function readStaffWorkspaceRoles(ctx: Pick<Ctx, "tenantId" | "userId" | "roleKey">): Promise<WorkspaceRoleOptions | null> {
  const { session } = await getStaffSession();
  if (!session?.user) return null;
  const businesses = await listClubChoices(session.user.id, new Date(session.session.createdAt));
  const current = businesses.find(business => business.tenantId === ctx.tenantId && business.roleKey === ctx.roleKey);
  if (!current) return null;
  const identity = { tenantId: ctx.tenantId, userId: ctx.userId };
  const linked = await withTenant(ctx.tenantId, tx => linkedRolesInTx(tx, identity, ["member", "guardian"]));
  const selfRoles = linked?.betterAuthId === session.user.id ? linked.roles : [];
  let signedInAudience: Audience | null = null;
  if (selfRoles.length) {
    const scoped = await resolveScopedSelfScope(null);
    if (scoped?.scope.userId === ctx.userId && scoped.scope.tenantId === ctx.tenantId) {
      try {
        signedInAudience = await scoped.read(async (_tx, scope) => scope.audience);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
  }
  const choices = selfRoles.map(role => roleChoice(role, ctx.tenantId, role === signedInAudience));
  const otherBusinesses = businesses.filter(business => business.tenantId !== ctx.tenantId);
  const hasDifferentStaffRole = otherBusinesses.some(business => business.roleKey !== ctx.roleKey);
  if (hasDifferentStaffRole) {
    choices.push({ label: "Switch business account", href: "/clubs", detail: "Choose an account and your role there" });
  }
  return { current: current.roleName, choices, showBusinessSwitch: otherBusinesses.length > 0 && !hasDifferentStaffRole };
}

/** A member or family session can list choices for the same linked account. */
export async function readSelfWorkspaceRoles(resolver: SelfScopeResolver): Promise<WorkspaceRoleOptions | null> {
  const { audience, tenantId } = resolver.scope;
  const alternate = audience === "member" ? "guardian" : "member";
  const linked = await resolver.read((tx, scope) => linkedRolesInTx(tx, {
    tenantId: scope.tenantId,
    userId: scope.userId,
  }, [alternate]));
  if (!linked) return null;

  const choices = linked.roles.map(role => roleChoice(role, tenantId, false));
  const { session, selectedBusiness } = await getStaffSession();
  const sameStaffSession = session?.user.id === linked.betterAuthId ? session : null;
  const currentBusinesses = await listClubChoices(linked.betterAuthId, new Date());
  const staff = currentBusinesses.find(business => business.tenantId === tenantId);
  if (staff) {
    const active = sameStaffSession
      ? await resolveDefaultMembership(sameStaffSession.user.id, selectedBusiness)
      : null;
    const alreadySignedIn = sameStaffSession && active?.tenantId === tenantId && !active.requiresSelection &&
      active.roleKey === staff.roleKey && !isSessionExpiredForRole(staff.roleKey, new Date(sameStaffSession.session.createdAt).getTime());
    const target = new URLSearchParams({ clubId: tenantId, role: staff.roleKey });
    choices.push({ label: staff.roleName, href: alreadySignedIn ? staff.homePath : `/login?${target}`,
      detail: alreadySignedIn ? "Open your staff workspace" : "Confirm with your PIN" });
  }
  return { current: SELF_ROLES[audience].label, choices };
}
