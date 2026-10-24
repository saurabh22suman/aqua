import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOpsHost, normalizeHost, opsHost, parseOpsHost } from "@/lib/ops-host";

// The platform (ops) surface moved off `ops.<base>` onto a sibling
// host of the tenant apex: aquaops.preprabbit.in beside
// aqua.preprabbit.in. These tests pin the resolution rules that
// decide which host serves /ops/* — the routing layer (middleware.ts)
// and the WhatsApp sign-in route (lib/auth/whatsapp-route.ts) both
// depend on them, and a wrong answer either opens /ops on the tenant
// apex or 404s the platform surface on its own host.

describe("lib/ops-host", () => {
  beforeEach(() => {
    vi.stubEnv("OPS_HOST", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("normalizeHost", () => {
    it("lowercases and drops the port", () => {
      expect(normalizeHost("AquaOps.Preprabbit.in:3222")).toBe(
        "aquaops.preprabbit.in",
      );
    });

    it("leaves a host without a port alone", () => {
      expect(normalizeHost("aqua.preprabbit.in")).toBe(
        "aqua.preprabbit.in",
      );
    });
  });

  describe("parseOpsHost", () => {
    it("accepts a bare hostname and lowercases it", () => {
      expect(parseOpsHost("AquaOps.Preprabbit.in")).toBe(
        "aquaops.preprabbit.in",
      );
    });

    it("rejects a value that is not a bare hostname", () => {
      // A scheme, a port or a path would all silently never match a
      // request's Host header — the platform surface would 404 on its
      // own host instead of failing at configuration time.
      expect(parseOpsHost("https://aquaops.preprabbit.in")).toBeNull();
      expect(parseOpsHost("aquaops.preprabbit.in:443")).toBeNull();
      expect(parseOpsHost("aquaops.preprabbit.in/ops")).toBeNull();
      expect(parseOpsHost("aquaops.preprabbit.in.")).toBeNull();
      expect(parseOpsHost("")).toBeNull();
      expect(parseOpsHost(undefined)).toBeNull();
    });

    it("rejects a hostname longer than 253 characters", () => {
      const long = `${"a".repeat(63)}.`.repeat(4) + `${"b".repeat(59)}`;
      expect(parseOpsHost(long)).toBeNull();
    });
  });

  describe("isOpsHost", () => {
    it("matches the configured platform host", () => {
      vi.stubEnv("OPS_HOST", "aquaops.preprabbit.in");
      expect(isOpsHost("aquaops.preprabbit.in")).toBe(true);
      expect(isOpsHost("aquaops.preprabbit.in:3000")).toBe(true);
      expect(isOpsHost("AQUAOPS.PREPRABBIT.IN")).toBe(true);
    });

    it("does not match the tenant apex", () => {
      vi.stubEnv("OPS_HOST", "aquaops.preprabbit.in");
      expect(isOpsHost("aqua.preprabbit.in")).toBe(false);
      expect(isOpsHost("aqua.preprabbit.in:3000")).toBe(false);
    });

    it("does not match a host that merely contains the platform host", () => {
      vi.stubEnv("OPS_HOST", "aquaops.preprabbit.in");
      expect(isOpsHost("aquaops.preprabbit.in.evil.test")).toBe(false);
      expect(isOpsHost("evil-aquaops.preprabbit.in")).toBe(false);
    });

    it("still recognises the legacy ops.<base> shape", () => {
      // Local development and any older deployment use this shape.
      vi.stubEnv("OPS_HOST", "aquaops.preprabbit.in");
      expect(isOpsHost("ops.localhost")).toBe(true);
      expect(isOpsHost("ops.localhost:3100")).toBe(true);
      expect(isOpsHost("ops.aqua.soloengine.in")).toBe(true);
    });

    it("falls back to the legacy shape when OPS_HOST is unset", () => {
      vi.stubEnv("OPS_HOST", undefined);
      expect(opsHost()).toBeNull();
      expect(isOpsHost("ops.localhost")).toBe(true);
      expect(isOpsHost("localhost")).toBe(false);
      expect(isOpsHost("aqua.preprabbit.in")).toBe(false);
    });

    it("treats a malformed OPS_HOST as unset rather than widening it", () => {
      vi.stubEnv("OPS_HOST", "https://aquaops.preprabbit.in");
      expect(opsHost()).toBeNull();
      expect(isOpsHost("aquaops.preprabbit.in")).toBe(false);
      expect(isOpsHost("ops.localhost")).toBe(true);
    });

    it("never matches a missing or empty host", () => {
      vi.stubEnv("OPS_HOST", "aquaops.preprabbit.in");
      expect(isOpsHost(null)).toBe(false);
      expect(isOpsHost(undefined)).toBe(false);
      expect(isOpsHost("")).toBe(false);
      expect(isOpsHost(":3000")).toBe(false);
    });
  });
});
