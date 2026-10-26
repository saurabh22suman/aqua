import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";
import { expectedDigest, startGateFixture, type GateFixture } from "./fixture";

// Mock-only gate access — the dedicated gate secret.
//
// A credential digest is the only thing standing between a leaked
// database and a member's PIN. Two properties matter, and both are
// about what happens when the secret changes:
//
//   1. The digest must come from a secret of ITS OWN. A routine
//      rotation of the platform's auth secret must not change every
//      digest in the fleet — if it does, every card a club has issued
//      stops working, silently, and nobody can tell why.
//   2. A missing or weak secret must fail LOUDLY. A secret that is
//      absent and quietly falls back to something else is worse than an
//      outage: the gate would deny every member and report "unknown
//      credential", which looks like a data problem, not a deployment
//      problem.
//
// The rotation story is a two-key ring: the current key issues, the
// previous key still verifies. A rotation therefore moves the old key
// to the previous slot and the new key to the current slot, and the
// fleet keeps working until the old key is dropped on purpose.

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";

const KEY_A = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const KEY_B = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const WEAK = "too-short";

let fx: GateFixture;

const SECRET_VARS = [
  "AQUA_GATE_SECRET",
  "AQUA_GATE_SECRET_PREVIOUS",
  "BETTER_AUTH_SECRET",
] as const;

const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  fx = await startGateFixture();
}, 180_000);

afterAll(async () => {
  await fx?.stop();
});

beforeEach(() => {
  for (const name of SECRET_VARS) saved[name] = process.env[name];
});

afterEach(() => {
  for (const name of SECRET_VARS) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("mock access — the dedicated gate secret", () => {
  it("does not derive the credential digest from the platform auth secret", () => {
    process.env.AQUA_GATE_SECRET = KEY_A;
    process.env.BETTER_AUTH_SECRET = "auth-secret-value-0123456789abcdef";

    const before = fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X");

    // A routine rotation of the platform's auth secret.
    process.env.BETTER_AUTH_SECRET = "rotated-auth-secret-0123456789abcdef";

    expect(fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X")).toBe(before);
  });

  it("uses the gate secret as the key", () => {
    process.env.AQUA_GATE_SECRET = KEY_A;
    const before = fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X");

    process.env.AQUA_GATE_SECRET = KEY_B;

    expect(fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X")).not.toBe(before);
  });

  it("fails closed when the gate secret is missing", () => {
    delete process.env.AQUA_GATE_SECRET;
    expect(() => fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X")).toThrow(
      /AQUA_GATE_SECRET/,
    );
  });

  it("fails closed when the gate secret is weak", () => {
    process.env.AQUA_GATE_SECRET = WEAK;
    expect(() => fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X")).toThrow(
      /AQUA_GATE_SECRET/,
    );
  });

  it("refuses a secret whose length is mostly padding", () => {
    // 31 spaces and one real character: 32 characters long, and
    // nothing like a key.
    process.env.AQUA_GATE_SECRET = `${" ".repeat(31)}x`;
    expect(() => fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X")).toThrow(
      /AQUA_GATE_SECRET contains whitespace/,
    );
  });

  it("refuses a secret that is padded at either end", () => {
    process.env.AQUA_GATE_SECRET = `  ${KEY_A}  `;
    expect(() => fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X")).toThrow(
      /AQUA_GATE_SECRET contains whitespace/,
    );
  });

  it("refuses a secret made of one repeated character", () => {
    process.env.AQUA_GATE_SECRET = "a".repeat(32);
    expect(() => fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X")).toThrow(
      /AQUA_GATE_SECRET is a single repeated character/,
    );
  });

  it("refuses a padded previous key on the same terms", () => {
    process.env.AQUA_GATE_SECRET = KEY_A;
    process.env.AQUA_GATE_SECRET_PREVIOUS = `${" ".repeat(31)}x`;
    expect(() => fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X")).toThrow(
      /AQUA_GATE_SECRET_PREVIOUS contains whitespace/,
    );
  });

  it("refuses a weak previous key on the same terms", () => {
    process.env.AQUA_GATE_SECRET = KEY_A;
    process.env.AQUA_GATE_SECRET_PREVIOUS = WEAK;
    expect(() => fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X")).toThrow(
      /AQUA_GATE_SECRET_PREVIOUS/,
    );
  });

  it("uses the key material verbatim, without normalising it", () => {
    process.env.AQUA_GATE_SECRET = KEY_A;
    // The fixture re-implements the derivation over the RAW key bytes.
    // If the service trimmed, padded or otherwise normalised the key,
    // the two would disagree.
    expect(fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X")).toBe(
      expectedDigest(TENANT, "rfid", "TAG-X"),
    );
  });

  it("keeps the digest stable for the same tenant, kind and secret", () => {
    process.env.AQUA_GATE_SECRET = KEY_A;
    const first = fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X");
    const second = fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X");
    expect(second).toBe(first);
  });

  it("keeps one tenant's digest out of another tenant's namespace", () => {
    process.env.AQUA_GATE_SECRET = KEY_A;
    expect(fx.services.secret.gateCredentialFingerprint(TENANT, "rfid", "TAG-X")).not.toBe(
      fx.services.secret.gateCredentialFingerprint(OTHER_TENANT, "rfid", "TAG-X"),
    );
  });
});

describe("mock access — a missing secret must not look like a bad credential", () => {
  it("fails a scan loudly instead of denying every member", async () => {
    const owner = {
      tenantId: asTenantId(fx.ids.tenantId),
      userId: asUserId(fx.ids.staffUserId),
      permissions: new Set(["settings.manage"]),
    };
    const issued = await fx.services.credentials.issueGateCredential(owner, {
      memberId: fx.ids.memberBooked,
      kind: "rfid",
      secret: "TAG-SECRET-FAIL-CLOSED",
    });
    expect(issued, JSON.stringify(issued)).toMatchObject({ ok: true });

    delete process.env.AQUA_GATE_SECRET;

    await expect(
      fx.services.gate.evaluateGateScan(
        {
          tenantId: asTenantId(fx.ids.tenantId),
          deviceKey: "court1",
          method: "rfid",
          secret: "TAG-SECRET-FAIL-CLOSED",
          clientEventId: "evt-fail-closed-1",
        },
        { now: new Date("2026-10-26T10:00:00.000Z") },
      ),
    ).rejects.toThrow(/AQUA_GATE_SECRET/);
  });
});

describe("mock access — rotating the gate secret", () => {
  it("keeps the issued fleet working while the previous key is held", async () => {
    process.env.AQUA_GATE_SECRET = KEY_A;
    process.env.BETTER_AUTH_SECRET = "auth-secret-value-0123456789abcdef";

    const owner = {
      tenantId: asTenantId(fx.ids.tenantId),
      userId: asUserId(fx.ids.staffUserId),
      permissions: new Set(["settings.manage"]),
    };
    const issued = await fx.services.credentials.issueGateCredential(owner, {
      memberId: fx.ids.memberBooked,
      kind: "rfid",
      secret: "TAG-ROTATION-001",
    });
    expect(issued, JSON.stringify(issued)).toMatchObject({ ok: true });

    // Rotate: the platform auth secret moves (a routine operation), the
    // gate secret rotates and the old key is kept in the previous slot.
    process.env.BETTER_AUTH_SECRET = "rotated-auth-secret-0123456789abcdef";
    process.env.AQUA_GATE_SECRET_PREVIOUS = KEY_A;
    process.env.AQUA_GATE_SECRET = KEY_B;

    const during = await fx.services.gate.evaluateGateScan(
      {
        tenantId: asTenantId(fx.ids.tenantId),
        deviceKey: "court1",
        method: "rfid",
        secret: "TAG-ROTATION-001",
        clientEventId: "evt-rotation-1",
      },
      { now: new Date("2026-10-26T10:00:00.000Z") },
    );
    expect(during.decision).toBe("granted");
    expect(during.memberId).toBe(fx.ids.memberBooked);
  });

  it("stops verifying a credential once its key is dropped on purpose", async () => {
    process.env.AQUA_GATE_SECRET = KEY_A;
    process.env.BETTER_AUTH_SECRET = "auth-secret-value-0123456789abcdef";

    const owner = {
      tenantId: asTenantId(fx.ids.tenantId),
      userId: asUserId(fx.ids.staffUserId),
      permissions: new Set(["settings.manage"]),
    };
    const issued = await fx.services.credentials.issueGateCredential(owner, {
      memberId: fx.ids.memberMembership,
      kind: "rfid",
      secret: "TAG-ROTATION-002",
    });
    expect(issued, JSON.stringify(issued)).toMatchObject({ ok: true });

    process.env.AQUA_GATE_SECRET_PREVIOUS = KEY_A;
    process.env.AQUA_GATE_SECRET = KEY_B;

    const during = await fx.services.gate.evaluateGateScan(
      {
        tenantId: asTenantId(fx.ids.tenantId),
        deviceKey: "court1",
        method: "rfid",
        secret: "TAG-ROTATION-002",
        clientEventId: "evt-rotation-2",
      },
      { now: new Date("2026-10-26T10:00:00.000Z") },
    );
    expect(during.decision).toBe("granted");

    // Dropping the old key is the deliberate end of the rotation.
    delete process.env.AQUA_GATE_SECRET_PREVIOUS;

    const after = await fx.services.gate.evaluateGateScan(
      {
        tenantId: asTenantId(fx.ids.tenantId),
        deviceKey: "court1",
        method: "rfid",
        secret: "TAG-ROTATION-002",
        clientEventId: "evt-rotation-3",
      },
      { now: new Date("2026-10-26T10:00:00.000Z") },
    );
    expect(after.decision).toBe("denied");
    expect(after.reasonCode).toBe("denied_unknown_credential");
  });

  it("does not let a cancelled card fall back to an older card on the previous key", async () => {
    // The same tag issued twice across a rotation: once under the old
    // key, once under the new one. Cancelling the new card must not
    // hand the tag back to the old card through the previous key.
    process.env.AQUA_GATE_SECRET = KEY_A;
    process.env.BETTER_AUTH_SECRET = "auth-secret-value-0123456789abcdef";

    const owner = {
      tenantId: asTenantId(fx.ids.tenantId),
      userId: asUserId(fx.ids.staffUserId),
      permissions: new Set(["settings.manage"]),
    };
    const first = await fx.services.credentials.issueGateCredential(owner, {
      memberId: fx.ids.memberBooked,
      kind: "rfid",
      secret: "TAG-FALLBACK-001",
    });
    expect(first.ok).toBe(true);

    process.env.AQUA_GATE_SECRET_PREVIOUS = KEY_A;
    process.env.AQUA_GATE_SECRET = KEY_B;

    // Re-issue the same tag under the new key: a different digest, so
    // a second credential row for the same tag.
    const second = await fx.services.credentials.issueGateCredential(owner, {
      memberId: fx.ids.memberBooked,
      kind: "rfid",
      secret: "TAG-FALLBACK-001",
    });
    expect(second.ok).toBe(true);

    await fx.services.credentials.revokeGateCredential(owner, {
      credentialId: second.ok ? second.credentialId : "",
    });

    const outcome = await fx.services.gate.evaluateGateScan(
      {
        tenantId: asTenantId(fx.ids.tenantId),
        deviceKey: "court1",
        method: "rfid",
        secret: "TAG-FALLBACK-001",
        clientEventId: "evt-fallback-1",
      },
      { now: new Date("2026-10-26T10:00:00.000Z") },
    );
    expect(outcome.decision).toBe("denied");
    expect(outcome.reasonCode).toBe("denied_unknown_credential");
  });

  it("treats a replay across a rotation as the same event, not a conflict", async () => {
    process.env.AQUA_GATE_SECRET = KEY_A;
    process.env.BETTER_AUTH_SECRET = "auth-secret-value-0123456789abcdef";

    const owner = {
      tenantId: asTenantId(fx.ids.tenantId),
      userId: asUserId(fx.ids.staffUserId),
      permissions: new Set(["settings.manage"]),
    };
    const issued = await fx.services.credentials.issueGateCredential(owner, {
      memberId: fx.ids.memberBooked,
      kind: "rfid",
      secret: "TAG-ROTATION-003",
    });
    expect(issued, JSON.stringify(issued)).toMatchObject({ ok: true });

    const now = new Date("2026-10-26T10:00:00.000Z");
    const first = await fx.services.gate.evaluateGateScan(
      {
        tenantId: asTenantId(fx.ids.tenantId),
        deviceKey: "court1",
        method: "rfid",
        secret: "TAG-ROTATION-003",
        clientEventId: "evt-rotation-4",
      },
      { now },
    );
    expect(first.decision).toBe("granted");

    // The rotation happens between the device's first attempt and its
    // retry. The retry is the SAME event, so it must be answered as the
    // same event — not as an attempt to take the event id over.
    process.env.AQUA_GATE_SECRET_PREVIOUS = KEY_A;
    process.env.AQUA_GATE_SECRET = KEY_B;

    const replay = await fx.services.gate.evaluateGateScan(
      {
        tenantId: asTenantId(fx.ids.tenantId),
        deviceKey: "court1",
        method: "rfid",
        secret: "TAG-ROTATION-003",
        clientEventId: "evt-rotation-4",
      },
      { now },
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.decision).toBe(first.decision);
    expect(replay.eventId).toBe(first.eventId);
  });
});
