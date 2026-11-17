import { redirect } from "next/navigation";
import { NotFoundError } from "@/lib/auth/context";
import { resolveSelfScope } from "@/lib/auth/self-scope";
import { SelfHome } from "@/components/self-home";
import { readSelfHome } from "@/lib/services/self-home";
import { billingSubjectInTx } from "@/lib/services/self-billing";
import { isBillingDeadlock } from "@/lib/services/self-billing-errors";
import { guidePreferenceKey } from "@/components/onboarding/guide-preference-key";

// THE MEMBER HOME.
//
// The scope is resolved for THIS request and the record is read INSIDE
// the guarded transaction: resolveSelfScope() returns a resolver whose
// read() rechecks the account, the club and the linkage rows in the same
// tenant transaction as the data read. A member id in a URL is never
// read, and there is no list of members anywhere on this surface.
//
// A null scope (no session, no live link) and a failed recheck both go
// to the member sign-in. An UNEXPECTED database failure is NOT masked as
// a sign-in: it is re-thrown, so the visitor sees a real failure rather
// than a signed-out page.
//
// The page is dynamic and private: it reads the request's cookies and is
// rendered per request. The service worker caches navigations for the
// coach register only, so nothing here is ever served from a cache.

export const dynamic = "force-dynamic";

export default async function MemberHomePage() {
  const resolver = await resolveSelfScope("member", null);
  if (!resolver) redirect("/member/sign-in");
  try {
    const { view, scopeKind, tenantId, guideKey } = await resolver.read(async (tx, scope) => ({
      view: await readSelfHome(tx, scope, "member"), scopeKind: scope.kind, tenantId: scope.tenantId, guideKey: guidePreferenceKey(scope.tenantId, scope.userId, "member"),
    }));
    // Separate transaction: a billing-only deadlock must not abort the home read.
    let canViewOwnBilling: boolean | null = null;
    if (scopeKind === "self_session") {
      try { canViewOwnBilling = await resolver.read(async (tx, scope) => (await billingSubjectInTx(tx, scope)) !== null); }
      catch (error) { if (!isBillingDeadlock(error)) throw error; }
    }
    return <SelfHome view={view} audience="member" scopeKind={scopeKind} tenantId={tenantId} canViewOwnBilling={canViewOwnBilling} guideKey={guideKey} />;
  } catch (error) {
    if (error instanceof NotFoundError) redirect("/member/sign-in");
    throw error;
  }
}
