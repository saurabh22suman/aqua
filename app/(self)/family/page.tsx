import { redirect } from "next/navigation";
import { NotFoundError } from "@/lib/auth/context";
import { resolveSelfScope } from "@/lib/auth/self-scope";
import { SelfHome } from "@/components/self-home";
import { readSelfHome } from "@/lib/services/self-home";

// THE FAMILY HOME.
//
// The scope is resolved for THIS request and the record is read INSIDE
// the guarded transaction: resolveSelfScope() returns a resolver whose
// read() rechecks the account, the club and the linkage rows in the same
// tenant transaction as the data read.
//
// The scope's child set IS the page's list: the currently linked child
// memberships and nothing else. A linked guardian keeps the access after
// the member turns 18, and only an explicit revocation ends it.
//
// A null scope (no session, no live link) and a failed recheck both go
// to the family sign-in. An UNEXPECTED database failure is NOT masked as
// a sign-in: it is re-thrown.
//
// The page is dynamic and private: it reads the request's cookies and is
// rendered per request.

export const dynamic = "force-dynamic";

export default async function FamilyHomePage() {
  const resolver = await resolveSelfScope("guardian", null);
  if (!resolver) redirect("/family/sign-in");
  try {
    const { view, scopeKind, tenantId } = await resolver.read(async (tx, scope) => ({
      view: await readSelfHome(tx, scope, "guardian"),
      scopeKind: scope.kind,
      tenantId: scope.tenantId,
    }));
    return <SelfHome view={view} audience="guardian" scopeKind={scopeKind} tenantId={tenantId} />;
  } catch (error) {
    if (error instanceof NotFoundError) redirect("/family/sign-in");
    throw error;
  }
}
