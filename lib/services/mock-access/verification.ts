// Mock-only gate access — credential verification.
//
// The verification boundary: a presented secret in, a credential (and
// therefore a member) out, or an explicit failure. Nothing else in
// this lane is allowed to look a raw secret up.
//
// The lookup is by keyed digest (see secret.ts), so it is a single
// indexed read and the stored value is never the secret itself. While a
// secret rotation is in flight the previous key is tried as well, so a
// card issued before the rotation keeps working.
//
// A missing or weak secret throws here rather than returning "unknown":
// a deployment that has lost its secret must fail loudly, not deny every
// member and report it as an invalid card.

import { and, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { gateCredentials } from "@/db/schema/mock-access";
import type { TenantId } from "@/lib/ids";
import {
  gateCredentialFingerprintCandidates,
  type GateSecretKind,
} from "./secret";

export type GateCredentialMatch = {
  credentialId: string;
  memberId: string;
  kind: GateSecretKind;
};

export type GateVerification =
  | { state: "verified"; match: GateCredentialMatch }
  | { state: "revoked"; match: GateCredentialMatch }
  | { state: "unknown" };

export async function verifyGateCredential(
  tx: TenantTx,
  tenantId: TenantId,
  kind: GateSecretKind,
  secret: string,
): Promise<GateVerification> {
  const candidates = gateCredentialFingerprintCandidates(
    tenantId,
    kind,
    secret,
  );

  for (const digest of candidates) {
    const rows = await tx
      .select({
        id: gateCredentials.id,
        memberId: gateCredentials.memberId,
        status: gateCredentials.status,
      })
      .from(gateCredentials)
      .where(
        and(
          eq(gateCredentials.tenantId, tenantId),
          eq(gateCredentials.kind, kind),
          eq(gateCredentials.secretHash, digest),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) continue;

    const match: GateCredentialMatch = {
      credentialId: row.id,
      memberId: row.memberId,
      kind,
    };
    return row.status === "revoked"
      ? { state: "revoked", match }
      : { state: "verified", match };
  }

  return { state: "unknown" };
}
