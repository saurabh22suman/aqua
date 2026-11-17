import { expect, it } from "vitest";
import { requirePermission } from "@/lib/auth/permission";

it.each(["bookings.read", "bookings.write"])("requires the %s grant and either existing booking entitlement", (permission) => {
  expect(() => requirePermission({ permissions: new Set([permission]), features: new Set(["pool.booking"]) }, permission)).not.toThrow();
  expect(() => requirePermission({ permissions: new Set([permission]), features: new Set(["court.booking"]) }, permission)).not.toThrow();
  expect(() => requirePermission({ permissions: new Set([permission]), features: new Set() }, permission)).toThrow();
  expect(() => requirePermission({ permissions: new Set(), features: new Set(["court.booking"]) }, permission)).toThrow();
  expect(() => requirePermission({ permissions: new Set(["unsupported.permission"]), features: new Set(["court.booking"]) }, "unsupported.permission")).toThrow();
});
