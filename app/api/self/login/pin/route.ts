// POSTIMAGE — app/api/self/login/pin/route.ts  (candidate, NOT applied)
//
// POST /api/self/login/pin — the member/guardian number + PIN door.
//
// IT NEVER CALLS auth.api.signInEmail AND NEVER WRITES A ba_session ROW.
// signInEmail CREATES a global better-auth session
// (lib/services/credentials.ts); a member sign-in must never mint a
// staff session. The credential is verified and nothing more.
//
// THE CLUB IS DERIVED FROM THE ACCOUNT'S OWN LIVE LINK ROWS, NEVER FROM
// A MEMBERSHIP. A membership is a STAFF concept; it is not a club
// enumerator for the member surface, and reading it here would have
// re-introduced the "linking must not create or depend on a membership"
// rule.
//
// EVERY FAILURE IS THE SAME GENERIC 401 — byte-identical for "no such
// number", "wrong PIN", "locked", "no member link", "ambiguous
// entitlement" and "throttled". The response never distinguishes them.
//
// THE ORDER IS LOAD-BEARING. account -> live link -> club -> BUDGET ->
// PIN. The attempt budget's tenant_id is NOT NULL, so there is no budget
// without a club, and the door must refuse BEFORE it compares a PIN.
//
// NO SMS AND NO OTP. Nothing here proves that anybody owns a phone.

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { withTenant, withUser } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { OPERATIONAL_TENANT_STATUSES } from "@/db/platform";
import { pinSchema } from "@/lib/services/credentials";
import { verifyPinCredentialInTx } from "@/db/pin-login";
import { runPinAttemptInTx } from "@/db/pin-attempt";
import {
  isPinLocked,
} from "@/lib/services/pin-lockout";
import { consumeSelfServiceBudgetInTx } from "@/lib/services/self-service-throttle";
import { readLinkFacts } from "@/lib/services/self-service-link-facts";
import { readSelfServiceAccountByPhone, readSelfServiceAccountInTx } from "@/db/self-service-account";
import { readAccountLinkClubs } from "@/lib/auth/self-scope";
import {
  SELF_SERVICE_COOKIE,
  SELF_SERVICE_SESSION_TTL_SECONDS,
  mintSelfServiceSessionInTx,
  validateOmittedGuardianLinks,
  selfServiceCookieOptions,
} from "@/lib/services/self-service-session";
import { normaliseToE164 } from "@/lib/phone";

// `clubId` is the club's TENANT ID -- an OPTIONAL, EXPLICIT club
// selector.
//
// It is a SELECTOR, never authority: it is validated against the derived
// entitlement set, and an id outside that set is refused with the generic
// failure. It is NOT the `?club=` slug the scope resolver compares inside
// the transaction -- the two club notions must not be conflated.
//
// It exists for ONE case: an account linked in MORE THAN ONE club.
// Without it, such an account is ambiguous and the door refuses.
const loginSchema = z.object({
  phone: z.string().trim().min(1).max(40),
  pin: pinSchema,
  clubId: z.string().uuid().optional(),
  // Optional selector, never authority. Validated against the DERIVED set.
  audience: z.enum(["member", "guardian"]).optional(),
});

type LoginResult =
  | { kind: "ok"; homePath: string }
  | { kind: "error"; code: "invalid_request" | "invalid_credentials" };

function genericFailure(): NextResponse {
  return NextResponse.json(
    { kind: "error", code: "invalid_credentials" } satisfies LoginResult,
    { status: 401 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!originAllowed(request)) return genericFailure();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { kind: "error", code: "invalid_request" } satisfies LoginResult,
      { status: 400 },
    );
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { kind: "error", code: "invalid_request" } satisfies LoginResult,
      { status: 400 },
    );
  }

  // The same normalisation the staff door uses.
  let phone: string;
  try { phone = normaliseToE164(parsed.data.phone); }
  catch { return genericFailure(); }

  // 1. THE ACCOUNT. Its lockout state, its identity and its own number.
  //    The number is GLOBALLY unique, so this is one row in the whole
  //    platform. This is the pre-tenant identity resolution, and it is
  //    the same shape as the staff door's own account lookup.
  const account = await readSelfServiceAccountByPhone(phone);
  if (!account) return genericFailure();
  if (isPinLocked(account.pinLockedUntil)) return genericFailure();

  // 2. THE CLUB, DERIVED FROM THE ACCOUNT'S OWN LIVE LINK ROWS.
  //    The read is under withUser(), so it sees ONLY the account's own
  //    linkage rows. It is a SELECTOR, not an authority: every row it
  //    returns is re-read INSIDE the chosen tenant, with the liveness
  //    joins and the recorded-number gate, before anything is minted.
  const derived = await withUser(account.userId, (tx) =>
    readAccountLinkClubs(tx, account.userId),
  );

  // THE EXPLICIT CLUB SELECTOR, when it is present.
  const clubId = parsed.data.clubId;
  const selected = clubId
    ? derived.filter((entry) => entry.tenantId === clubId)
    : derived;
  const clubIds = [...new Set(selected.map((entry) => entry.tenantId))];

  // ONE CLUB. An account linked in two clubs and naming none is
  // ambiguous, and the door refuses with the generic failure rather than
  // guessing.
  if (clubIds.length !== 1) return genericFailure();
  const tenantId = clubIds[0]!;

  // THE AUDIENCE, derived. A named audience is a SELECTOR: it is accepted
  // only when it is in the DERIVED set. An unnamed request is accepted
  // only when the derived set has exactly one audience for this club.
  const clubEntries = selected.filter((entry) => entry.tenantId === tenantId);
  const audiences = [...new Set(clubEntries.map((entry) => entry.audience))];
  let audience: "member" | "guardian";
  if (parsed.data.audience !== undefined) {
    if (!audiences.includes(parsed.data.audience)) return genericFailure();
    audience = parsed.data.audience;
  } else if (audiences.length === 1) {
    audience = audiences[0]!;
  } else {
    return genericFailure();
  }

  const linkIds = clubEntries
    .filter((entry) => entry.audience === audience)
    .flatMap((entry) => entry.linkIds);
  if (linkIds.length === 0) return genericFailure();

  // 3. THE BUDGET, spent BEFORE the credential is touched, and the
  //    AUTHORITATIVE READ of the link rows, in the club's own scope.
  //    The budget needs the club, and the club is now known. The read
  //    refuses before the PIN is compared when the account has no live
  //    link here — the ordering is a security property, not a style
  //    choice.
  const prepared = await withTenant(tenantId, async (tx) => {
    const withinBudget = await consumeSelfServiceBudgetInTx(tx, {
      tenantId,
      userId: account.userId,
      address: account.phone,
    });
    if (!withinBudget) return null;

    const [tenant] = await tx.select({ id: tenants.id }).from(tenants)
      .where(and(eq(tenants.id, tenantId), inArray(tenants.status, [...OPERATIONAL_TENANT_STATUSES])))
      .limit(1).for("share");
    if (!tenant || !await readSelfServiceAccountInTx(tx, { tenantId, userId: account.userId })) return null;

    const facts = await readLinkFacts(tx, {
      tenantId,
      userId: account.userId,
      audience,
      linkIds,
    });
    if (facts.length !== linkIds.length) return null;
    // Omit only a proven soft-deleted child from a fresh guardian binding.
    // Every remaining link still passes the full mint-time authorization.
    const omitted = audience === "guardian" ? facts.filter((f) => f.childPersonSoftDeleted).map((f) => f.linkId) : [];
    if (!await validateOmittedGuardianLinks(tx, { tenantId, userId: account.userId, linkIds: omitted, accountPhone: account.phone })) return null;
    const eligible = audience === "guardian" ? facts.filter((f) => !f.childPersonSoftDeleted) : facts;
    if (!eligible.length || !eligible.every((f) => f.linkIsLive && f.relationshipIsLive)) return null;

    return {
      subjectId: audience === "member" ? (eligible[0]?.memberId ?? null) : null,
      linkIds: eligible.map((f) => f.linkId),
    };
  });
  if (!prepared) return genericFailure();
  if (audience === "member" && prepared.subjectId === null) {
    return genericFailure();
  }

  // 4. Credential verification, lockout bookkeeping and mint share one
  // tenant transaction and one account UPDATE lock. No staff session is made.
  const baUserId = account.betterAuthId;
  if (!baUserId) return genericFailure();
  const minted = await withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.select({ id: tenants.id }).from(tenants)
      .where(and(eq(tenants.id, tenantId), inArray(tenants.status, [...OPERATIONAL_TENANT_STATUSES])))
      .limit(1).for("share");
    if (!tenant) return null;
    const locked = await readSelfServiceAccountInTx(tx, { tenantId, userId: account.userId, lockMode: "update" });
    if (!locked || locked.phone !== phone || locked.betterAuthId !== baUserId) return null;
    const attempt = await runPinAttemptInTx(tx, {
      id: locked.userId, failedPinAttempts: locked.failedPinAttempts, pinLockedUntil: locked.pinLockedUntil,
    }, async (verifyTx) => {
      if (!await verifyPinCredentialInTx(verifyTx, locked.betterAuthId, baUserId, parsed.data.pin)) return { ok: false };
      // Mint refusal rolls back only its writes, not a valid PIN's counter reset.
      try {
        const session = await verifyTx.transaction((mintTx) => mintSelfServiceSessionInTx(mintTx, {
          tenantId, userId: locked.userId, audience, subjectId: prepared.subjectId,
          linkIds: prepared.linkIds, accountPhone: locked.phone,
        }));
        return { ok: true, value: session };
      } catch {
        return { ok: true, value: null };
      }
    });
    return attempt.ok ? attempt.value : null;
  }).catch(() => null);
  if (!minted) return genericFailure();

  const res = NextResponse.json({
    kind: "ok",
    homePath: audience === "member" ? "/member" : "/family",
  } satisfies LoginResult);
  res.cookies.set(
    SELF_SERVICE_COOKIE,
    minted.cookieValue,
    selfServiceCookieOptions(SELF_SERVICE_SESSION_TTL_SECONDS),
  );
  return res;
}

/** Match the existing self/logout origin policy before minting a cookie. */
function originAllowed(request: Request): boolean {
  const host = request.headers.get("host")?.toLowerCase();
  if (!host) return false;
  let origin: URL;
  try { origin = new URL(request.headers.get("origin") ?? ""); }
  catch { return false; }
  return origin.host.toLowerCase() === host &&
    (process.env.NODE_ENV !== "production" || origin.protocol === "https:");
}
