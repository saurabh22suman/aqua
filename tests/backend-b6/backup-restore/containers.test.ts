import { describe, expect, it } from "vitest";
import {
  assertOwnedContainerName,
  buildContainerName,
  buildExecArgs,
  buildListOwnedArgs,
  buildRemoveArgs,
  buildRunArgs,
  parsePublishedPort,
} from "@/scripts/lib/disposable-restore/containers";

// B6 — how the drill creates and destroys its own Postgres containers.
//
// Two properties matter more than anything else here:
//
//   1. The published host port is AUTO-ASSIGNED by Docker. The drill
//      never picks a port, so it can never collide with the harness
//      database, the dev database or another agent's container.
//   2. Cleanup names exactly ONE container, and only one this run
//      created. There is no prune, no remove-all, no "clean up stale
//      drill containers" — a drill that broadens its cleanup would
//      delete somebody else's work.
//
// These are pure functions over command arguments, so they are
// asserted directly rather than inferred from a running container.

const IDENTITY = "aqua-drill-0a1b2c3d4e5f";

describe("buildContainerName", () => {
  it("names the container after its minted identity and role", () => {
    expect(buildContainerName(IDENTITY, "source")).toBe(
      "aqua-drill-0a1b2c3d4e5f-source",
    );
    expect(buildContainerName(IDENTITY, "destination")).toBe(
      "aqua-drill-0a1b2c3d4e5f-destination",
    );
  });
});

describe("buildRunArgs", () => {
  const args = buildRunArgs(
    { identity: IDENTITY, role: "source" },
    "throwaway-password",
  );

  it("starts a detached container under the drill's own name", () => {
    expect(args.slice(0, 2)).toEqual(["run", "--detach"]);
    expect(args).toContain("--name");
    expect(args).toContain("aqua-drill-0a1b2c3d4e5f-source");
  });

  it("labels the container so it can be recognised and reported", () => {
    expect(args).toContain("aqua.drill=b6");
  });

  it("lets Docker assign the host port instead of picking one", () => {
    expect(args).toContain("127.0.0.1::5432");
    // The publish specification leaves the HOST port empty, so Docker
    // assigns a free one. No other argument may carry a host:port.
    const publish = args[args.indexOf("--publish") + 1];
    expect(publish).toBe("127.0.0.1::5432");
    for (const arg of args) {
      if (arg === publish) continue;
      expect(arg).not.toMatch(/127\.0\.0\.1:\d+/);
    }
  });

  it("keeps the container's data in tmpfs so nothing survives it", () => {
    expect(args).toContain("/var/lib/postgresql/data");
    expect(args).toContain("--tmpfs");
  });

  it("uses PostgreSQL 16 by default", () => {
    expect(args[args.length - 1]).toBe("postgres:16");
  });

  it("never passes the password on the command line of a dump tool", () => {
    // The password belongs in the container's own environment; it is
    // never an argument to pg_dump/pg_restore.
    expect(args.join(" ")).toContain("POSTGRES_PASSWORD=throwaway-password");
    const exec = buildExecArgs("aqua-drill-0a1b2c3d4e5f-source", [
      "pg_dump",
      "--dbname=aqua_drill",
    ]);
    expect(exec.join(" ")).not.toContain("throwaway-password");
  });
});

describe("buildExecArgs", () => {
  it("executes a command inside the named container", () => {
    expect(
      buildExecArgs("aqua-drill-0a1b2c3d4e5f-source", ["pg_dump", "--version"]),
    ).toEqual([
      "exec",
      "aqua-drill-0a1b2c3d4e5f-source",
      "pg_dump",
      "--version",
    ]);
  });

  it("attaches stdin only when the caller asks for it", () => {
    expect(
      buildExecArgs("aqua-drill-0a1b2c3d4e5f-destination", ["pg_restore"]),
    ).not.toContain("-i");
    expect(
      buildExecArgs(
        "aqua-drill-0a1b2c3d4e5f-destination",
        ["pg_restore"],
        { stdin: true },
      ),
    ).toEqual([
      "exec",
      "-i",
      "aqua-drill-0a1b2c3d4e5f-destination",
      "pg_restore",
    ]);
  });
});

describe("parsePublishedPort", () => {
  it("reads the auto-assigned port out of docker port output", () => {
    expect(parsePublishedPort("127.0.0.1:32768\n")).toBe(32768);
  });

  it("reads the port when docker binds every interface", () => {
    expect(parsePublishedPort("0.0.0.0:49153\n")).toBe(49153);
  });

  it("reads the port when docker binds IPv6", () => {
    expect(parsePublishedPort(":::49154\n")).toBe(49154);
  });

  it("throws when docker reports no published port", () => {
    expect(() => parsePublishedPort("")).toThrow(/port/i);
  });

  it("throws when the published port is not a number", () => {
    expect(() => parsePublishedPort("127.0.0.1:notaport\n")).toThrow(/port/i);
  });
});

describe("assertOwnedContainerName", () => {
  it("accepts a container this drill owns", () => {
    expect(() =>
      assertOwnedContainerName("aqua-drill-0a1b2c3d4e5f-source"),
    ).not.toThrow();
  });

  it("rejects a container outside the drill namespace", () => {
    expect(() => assertOwnedContainerName("aqua-db")).toThrow();
    expect(() => assertOwnedContainerName("aqua-harness-test-bc7104d290")).toThrow();
    expect(() => assertOwnedContainerName("postgres")).toThrow();
  });

  it("rejects a drill name without a role suffix", () => {
    expect(() => assertOwnedContainerName("aqua-drill-0a1b2c3d4e5f")).toThrow();
  });
});

describe("buildRemoveArgs", () => {
  it("removes exactly one named container", () => {
    expect(buildRemoveArgs("aqua-drill-0a1b2c3d4e5f-source")).toEqual([
      "rm",
      "--force",
      "aqua-drill-0a1b2c3d4e5f-source",
    ]);
  });

  it("refuses to build a removal for a container it does not own", () => {
    expect(() => buildRemoveArgs("aqua-db")).toThrow();
  });

  it("never produces a prune or a remove-all", () => {
    const args = buildRemoveArgs("aqua-drill-0a1b2c3d4e5f-source");
    expect(args.join(" ")).not.toMatch(/prune|system|volume|--all/);
  });
});

describe("buildListOwnedArgs", () => {
  it("lists only containers carrying the drill label", () => {
    const args = buildListOwnedArgs();
    expect(args.join(" ")).toContain("aqua.drill=b6");
    expect(args.join(" ")).not.toMatch(/prune|--all/);
  });
});
