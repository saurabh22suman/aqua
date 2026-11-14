import { eq } from "drizzle-orm";
import { createAuth } from "@/lib/auth/server";
import { normaliseToE164 } from "@/lib/phone";
import { baUser } from "./schema/better-auth";
import { runPinAttempt } from "./pin-attempt";
import { consumePinAddressBudget } from "./pin-login-budget";
import type { UserId } from "@/lib/ids";

function refused(): Response {
  return Response.json({kind:"error",code:"invalid_credentials"},{status:401});
}

export async function pinLogin(rawPhone: string, pin: string, requestHeaders?: Headers): Promise<Response> {
  // Internal credential callers have no HTTP identity. The public route
  // ALWAYS supplies headers and spends an address attempt, including unknown
  // phones. The account lock is enforced on both paths and across processes.
  if (requestHeaders && !(await consumePinAddressBudget(requestHeaders))) return refused();
  const result = await runPinAttempt<Response>({phone:normaliseToE164(rawPhone)}, async tx => {
    const [account] = await tx.select({email:baUser.email}).from(baUser)
      .where(eq(baUser.phoneNumber, normaliseToE164(rawPhone))).limit(1);
    if (!account) return {ok:false};
    const auth = createAuth(tx, {transactionalSession:true});
    const response = await auth.api.signInEmail({body:{email:account.email,password:pin},asResponse:true});
    return response.ok ? {ok:true,value:response} : {ok:false};
  });
  return result.ok ? result.value : refused();
}

// The member/family door shares account lockout but never creates a staff
// session. Its caller must resolve and validate the live self-service links
// first; those tenant/audience checks are not replaced by a correct PIN.
export async function verifyPinAttempt(userId: UserId, baUserId: string, pin: string): Promise<boolean> {
  const result = await runPinAttempt({userId}, async (tx, user) => {
    if (user.betterAuthId !== baUserId) return {ok:false};
    const context = await createAuth(tx, {transactionalSession:true}).$context;
    const account = await context.internalAdapter.findCredentialAccount(baUserId);
    if (!account?.password || !(await context.password.verify({hash:account.password,password:pin}))) return {ok:false};
    return {ok:true,value:true};
  });
  return result.ok;
}
