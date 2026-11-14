import { expect, it } from "vitest";
import { pwaManifest, tenantInstallManifest } from "@/lib/offline/pwa-manifest";

const tenantId = "0190c000-0000-7000-8000-000000000001";
const digest = "a".repeat(64);
const build = tenantInstallManifest;

it("uses a stable tenant UUID and declares exact icon sizes without changing the global identity", () => {
  const result = build({ tenantId, name: "Club One", iconDigest: digest, source: "staff" });
  const base = `/clubs/${tenantId}`;
  expect(result?.id).toBe(`${base}/install`);
  expect(result?.start_url).toBe(`${base}/launch`);
  expect(result?.icons).toEqual([
    { src: `${base}/icon/${digest}/192?source=staff`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `${base}/icon/${digest}/512?source=staff`, sizes: "512x512", type: "image/png", purpose: "any" },
  ]);
  expect([pwaManifest.id, pwaManifest.start_url, pwaManifest.scope]).toEqual(["/", "/", "/"]);
});
it("rejects mutable slugs, malformed UUIDs and invalid digests", () => {
  expect(build({ tenantId: "club-one", name: "X", iconDigest: digest, source: "staff" })).toBeNull();
  expect(build({ tenantId, name: "X", iconDigest: "invalid", source: "staff" })).toBeNull();
});
it("uses the explicit source only for icon fetching, never for install identity or launch", () => {
  const input = { tenantId, name: "Club One", iconDigest: digest, source: "guardian" as const };
  const result = build(input);
  expect(result?.id).toBe(`/clubs/${tenantId}/install`);
  expect(result?.start_url).toBe(`/clubs/${tenantId}/launch`);
  expect(result?.icons?.every((icon) => icon.src.endsWith("?source=guardian"))).toBe(true);
});
it("uses public product icons when the tenant has no valid uploaded icon", () => {
  const input = { tenantId, name: "Club One", iconDigest: null, source: "staff" as const };
  const result = build(input);
  expect(result?.icons?.map((icon) => icon.src)).toEqual(["/icons/aqua-192.png", "/icons/aqua-512.png"]);
});
