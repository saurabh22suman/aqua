import type { TenantTx } from "@/db/tenant";
import { consents, guardianships, type ConsentPurpose } from "@/db/schema/consent";

export type ConsentEvidenceInput = {
  channel: string;
  ipAddress?: string;
  userAgent?: string;
};

export type ConsentGrantInput = {
  purpose: ConsentPurpose;
  policyVersion: string;
  evidence: ConsentEvidenceInput;
};

// Writes one immutable consent row. The evidence snapshot (granterName,
// granterRelationship) is captured here, at grant time, rather than left
// as a live join to the granter's person row -- V-47 (erasure) can later
// reduce that person to an opaque id, and this record has to remain
// meaningful to a regulator after that happens.
export async function recordConsent(
  tx: TenantTx,
  params: {
    tenantId: string;
    personId: string;
    grantedBy: string;
    witnessedByUserId?: string;
    granterName: string;
    granterRelationship: string;
    grant: ConsentGrantInput;
  },
): Promise<void> {
  await tx.insert(consents).values({
    tenantId: params.tenantId,
    personId: params.personId,
    purpose: params.grant.purpose,
    grantedBy: params.grantedBy,
    witnessedByUserId: params.witnessedByUserId,
    policyVersion: params.grant.policyVersion,
    evidence: {
      ...params.grant.evidence,
      granterName: params.granterName,
      granterRelationship: params.granterRelationship,
    },
  });
}

export async function createGuardianship(
  tx: TenantTx,
  params: {
    tenantId: string;
    minorId: string;
    guardianId: string;
    relationship: string;
    isPrimary: boolean;
    createdBy?: string;
  },
): Promise<void> {
  await tx.insert(guardianships).values({
    tenantId: params.tenantId,
    minorId: params.minorId,
    guardianId: params.guardianId,
    relationship: params.relationship,
    isPrimary: params.isPrimary,
    createdBy: params.createdBy,
    updatedBy: params.createdBy,
  });
}
