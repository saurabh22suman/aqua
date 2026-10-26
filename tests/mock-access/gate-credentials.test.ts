import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";
import {
  expectedDigest,
  startGateFixture,
  type GateFixture,
} from "./fixture";

// Mock-only gate access — gate credentials.
//
// The rule this file exists to pin: a PIN or an RFID tag is never
// stored. The database holds a keyed digest and nothing else, and a
// staff login can never become a gate credential because a credential
// belongs to a MEMBER, not to a user.

let fx: GateFixture;

const SECRET = "7391";

function owner() {
  return {
    tenantId: asTenantId(fx.ids.tenantId),
    userId: asUserId(fx.ids.staffUserId),
    permissions: new Set(["settings.manage"]),
  };
}

function receptionist() {
  return {
    tenantId: asTenantId(fx.ids.tenantId),
    userId: asUserId(fx.ids.staffUserId),
    permissions: new Set(["members.read", "bookings.write"]),
  };
}

beforeAll(async () => {
  fx = await startGateFixture();
}, 180_000);

afterAll(async () => {
  await fx?.stop();
});

describe("mock access — gate credentials", () => {
  it("stores a keyed digest and never the secret", async () => {
    const issued = await fx.services.credentials.issueGateCredential(owner(), {
      memberId: fx.ids.memberNothing,
      kind: "pin",
      secret: SECRET,
      label: "Front desk PIN",
    });
    expect(issued).toMatchObject({ ok: true });

    const rows = await fx.admin.query<{
      secret_hash: string;
      label: string | null;
      kind: string;
    }>(
      "select secret_hash, label, kind from gate_credentials where tenant_id = $1 and secret_hash = $2",
      [fx.ids.tenantId, expectedDigest(fx.ids.tenantId, "pin", SECRET)],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.secret_hash).toBe(
      expectedDigest(fx.ids.tenantId, "pin", SECRET),
    );
    // The stored value is the keyed digest — 64 hex characters, and
    // not the secret in any form.
    expect(rows.rows[0]!.secret_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the raw secret out of every stored column", async () => {
    await fx.services.credentials.issueGateCredential(owner(), {
      memberId: fx.ids.memberNothing,
      kind: "rfid",
      secret: "TAG-RAW-SECRET-999",
    });

    const rows = await fx.admin.query<Record<string, unknown>>(
      "select * from gate_credentials where tenant_id = $1",
      [fx.ids.tenantId],
    );
    const serialised = JSON.stringify(rows.rows);
    expect(serialised).not.toContain("TAG-RAW-SECRET-999");
  });

  it("keeps the raw secret out of the audit trail", async () => {
    await fx.services.credentials.issueGateCredential(owner(), {
      memberId: fx.ids.memberNothing,
      kind: "rfid",
      secret: "TAG-AUDIT-SECRET-777",
    });

    const rows = await fx.admin.query<Record<string, unknown>>(
      "select * from audit_log where tenant_id = $1",
      [fx.ids.tenantId],
    );
    expect(JSON.stringify(rows.rows)).not.toContain("TAG-AUDIT-SECRET-777");
  });

  it("refuses a credential for somebody who is not a member", async () => {
    const result = await fx.services.credentials.issueGateCredential(owner(), {
      memberId: fx.ids.staffUserId,
      kind: "pin",
      secret: "112233",
    });
    expect(result).toEqual({ ok: false, error: "Member not found." });
  });

  it("refuses a caller who cannot manage gate access", async () => {
    const result = await fx.services.credentials.issueGateCredential(
      receptionist(),
      { memberId: fx.ids.memberNothing, kind: "pin", secret: "445566" },
    );
    expect(result.ok).toBe(false);

    const rows = await fx.admin.query<{ n: number }>(
      "select count(*)::int as n from gate_credentials where secret_hash = $1",
      [expectedDigest(fx.ids.tenantId, "pin", "445566")],
    );
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("refuses a second credential for the same secret", async () => {
    const result = await fx.services.credentials.issueGateCredential(owner(), {
      memberId: fx.ids.memberMembership,
      kind: "rfid",
      secret: "TAG-BOOKED-001",
    });
    expect(result).toEqual({
      ok: false,
      error: "That card or PIN is already issued in this academy.",
    });
  });

  it("revokes a credential without deleting its history", async () => {
    const issued = await fx.services.credentials.issueGateCredential(owner(), {
      memberId: fx.ids.memberNothing,
      kind: "pin",
      secret: "864209",
    });
    expect(issued.ok).toBe(true);
    const credentialId = issued.ok ? issued.credentialId : "";

    const revoked = await fx.services.credentials.revokeGateCredential(owner(), {
      credentialId,
    });
    expect(revoked).toEqual({ ok: true });

    const rows = await fx.admin.query<{ status: string }>(
      "select status from gate_credentials where id = $1",
      [credentialId],
    );
    expect(rows.rows[0]!.status).toBe("revoked");
  });
});
