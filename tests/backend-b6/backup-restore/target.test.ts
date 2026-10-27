import { describe, expect, it } from "vitest";
import {
  assertDisposableIdentity,
  assertDisposableTarget,
  assertDistinctTargets,
  assertLoopbackHost,
  redactConnectionUri,
  type DisposableTarget,
} from "@/scripts/lib/disposable-restore/target";

// B6 — the disposable restore drill's trust boundary.
//
// The drill restores a backup into a database. That is the most
// destructive operation in this repository: it overwrites a live
// database if it is pointed at the wrong one. So the target
// identification is NOT a convenience — it is the control that makes
// "restore into a throwaway" safe, and it is the thing every negative
// case below defends.
//
// The rule the drill enforces: a restore target is only ever a
// database this run itself created, on loopback, under a minted
// identity. Anything else — a remote host, a live/production/staging
// database, a URL somebody pasted in — is rejected before a single
// byte is written.
//
// No container, no Docker, no database: these are pure predicates.

const VALID_IDENTITY = "aqua-drill-0a1b2c3d4e5f";

function target(overrides: Partial<DisposableTarget> = {}): DisposableTarget {
  return {
    identity: VALID_IDENTITY,
    role: "source",
    host: "127.0.0.1",
    port: 40001,
    database: "aqua_drill",
    containerName: "aqua-drill-0a1b2c3d4e5f-source",
    adminUri: "postgresql://aqua:secret@127.0.0.1:40001/aqua_drill",
    appUri: "postgresql://app_login:secret@127.0.0.1:40001/aqua_drill",
    appPassword: "secret",
    ...overrides,
  };
}

describe("assertDisposableIdentity", () => {
  it("accepts a minted drill identity", () => {
    expect(() => assertDisposableIdentity(VALID_IDENTITY)).not.toThrow();
  });

  it("rejects a live/production identity", () => {
    expect(() => assertDisposableIdentity("aqua-production-db")).toThrow(
      /production/i,
    );
  });

  it("rejects a staging identity", () => {
    expect(() => assertDisposableIdentity("aqua-staging-db")).toThrow(/staging/i);
  });

  it("rejects a live identity", () => {
    expect(() => assertDisposableIdentity("aqua-live-db")).toThrow(/live/i);
  });

  it("rejects a development identity", () => {
    expect(() => assertDisposableIdentity("aqua-dev-db")).toThrow(/dev/i);
  });

  it("rejects a connection URL", () => {
    expect(() =>
      assertDisposableIdentity("postgresql://aqua:pw@db.internal:5432/aqua"),
    ).toThrow();
  });

  it("rejects an empty identity", () => {
    expect(() => assertDisposableIdentity("")).toThrow();
  });

  it("rejects an identity that only looks like a drill identity", () => {
    // Uppercase hex, a wrong suffix, or a longer prefix must not pass:
    // the identity namespace is closed, so anything outside it is
    // something this run did not mint.
    expect(() => assertDisposableIdentity("aqua-drill-0A1B2C3D4E5F")).toThrow();
    expect(() => assertDisposableIdentity("aqua-drill-0a1b2c3d4e5")).toThrow();
    expect(() => assertDisposableIdentity("aqua-drill-0a1b2c3d4e5ff")).toThrow();
    expect(() => assertDisposableIdentity("xaqua-drill-0a1b2c3d4e5f")).toThrow();
  });

  it("never echoes a credential in the rejection message", () => {
    let message = "";
    try {
      assertDisposableIdentity("postgresql://aqua:hunter2@db.internal:5432/aqua");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toContain("hunter2");
  });
});

describe("assertLoopbackHost", () => {
  it("accepts loopback hosts", () => {
    expect(() => assertLoopbackHost("127.0.0.1")).not.toThrow();
    expect(() => assertLoopbackHost("::1")).not.toThrow();
    expect(() => assertLoopbackHost("localhost")).not.toThrow();
  });

  it("rejects a remote host", () => {
    expect(() => assertLoopbackHost("db.internal")).toThrow(/loopback/i);
  });

  it("rejects a private LAN address", () => {
    expect(() => assertLoopbackHost("10.0.0.5")).toThrow(/loopback/i);
  });

  it("rejects an empty host", () => {
    expect(() => assertLoopbackHost("")).toThrow();
  });
});

describe("assertDistinctTargets", () => {
  it("rejects the same database as both source and destination", () => {
    const source = target({ role: "source" });
    const destination = target({
      role: "destination",
      identity: VALID_IDENTITY,
      containerName: source.containerName,
    });
    expect(() => assertDistinctTargets(source, destination)).toThrow(
      /distinct|different/i,
    );
  });

  it("rejects two targets that share a container", () => {
    const source = target({ role: "source" });
    const destination = target({
      role: "destination",
      identity: "aqua-drill-111111111111",
      containerName: source.containerName,
    });
    expect(() => assertDistinctTargets(source, destination)).toThrow(
      /distinct|different/i,
    );
  });

  it("accepts two genuinely separate drill targets", () => {
    const source = target({ role: "source" });
    const destination = target({
      role: "destination",
      identity: "aqua-drill-111111111111",
      containerName: "aqua-drill-111111111111-destination",
      port: 40002,
      appUri: "postgresql://app_login:secret@127.0.0.1:40002/aqua_drill",
      adminUri: "postgresql://aqua:secret@127.0.0.1:40002/aqua_drill",
    });
    expect(() => assertDistinctTargets(source, destination)).not.toThrow();
  });

  it("rejects two targets that point at the same database", () => {
    // Different names, same host:port/database — that is one database
    // wearing two hats, and restoring it over itself destroys the only
    // copy of the data under verification.
    const source = target({ role: "source" });
    const destination = target({
      role: "destination",
      identity: "aqua-drill-111111111111",
      containerName: "aqua-drill-111111111111-destination",
    });
    expect(() => assertDistinctTargets(source, destination)).toThrow(
      /distinct|different/i,
    );
  });
});

describe("assertDisposableTarget", () => {
  it("accepts a well-formed disposable target", () => {
    expect(() => assertDisposableTarget(target())).not.toThrow();
  });

  it("rejects a target whose container name is outside the drill namespace", () => {
    expect(() =>
      assertDisposableTarget(target({ containerName: "aqua-db" })),
    ).toThrow();
  });

  it("rejects an out-of-range port", () => {
    expect(() => assertDisposableTarget(target({ port: 0 }))).toThrow();
    expect(() => assertDisposableTarget(target({ port: 70000 }))).toThrow();
  });

  it("rejects a database name outside the drill namespace", () => {
    expect(() =>
      assertDisposableTarget(target({ database: "aqua_club" })),
    ).toThrow();
  });

  it("rejects a remote host even when the identity looks right", () => {
    expect(() =>
      assertDisposableTarget(target({ host: "db.internal" })),
    ).toThrow(/loopback/i);
  });
});

describe("redactConnectionUri", () => {
  it("removes the password from a connection string", () => {
    const redacted = redactConnectionUri(
      "postgresql://aqua:hunter2@127.0.0.1:40001/aqua_drill",
    );
    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain("127.0.0.1");
    expect(redacted).toContain("40001");
  });

  it("removes the password from a URL-encoded password", () => {
    const redacted = redactConnectionUri(
      "postgresql://aqua:p%40ss%3Aword@127.0.0.1:40001/aqua_drill",
    );
    expect(redacted).not.toContain("p%40ss%3Aword");
  });

  it("does not throw on a malformed connection string", () => {
    expect(() => redactConnectionUri("not-a-url")).not.toThrow();
  });
});
