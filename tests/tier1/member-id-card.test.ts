import { describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import {
  buildMemberIdPayload,
  parseMemberIdPayload,
} from "@/lib/members/id-card";

// §5.2 — Member identity card payload format pin.
//
// Cards printed today will be in parents' hands and on academy walls
// before V-21 ships. When V-21's scanner lands, it has to decode
// cards that already exist. Any drift in the payload format means
// re-issuing every physical card — that's a re-print cost, plus the
// operator has to chase the change down with every member.
//
// This test pins the format to the literal shape approved:
//   aqua://m/<tenantSlug>/<memberUuid>
//
// If anyone changes the scheme, the host, the segment order, or
// drops the leading slash, this test fails. The "drift" cases
// below show what counts as drift.

const SEED_UUID = "018a6b3a-7c8d-7e0a-b012-3456789abcde";
const SEED_SLUG = "kicks-academy";

describe("member identity card payload format (§5.2)", () => {
  it("encodes exactly aqua://m/<slug>/<uuid> — no other characters between segments", () => {
    const payload = buildMemberIdPayload(SEED_SLUG, SEED_UUID);
    expect(payload).toBe("aqua://m/kicks-academy/018a6b3a-7c8d-7e0a-b012-3456789abcde");
  });

  it("round-trips through parseMemberIdPayload — same slug and uuid come out", () => {
    const payload = buildMemberIdPayload("demo-academy", SEED_UUID);
    const parsed = parseMemberIdPayload(payload);
    expect(parsed).not.toBeNull();
    expect(parsed!.tenantSlug).toBe("demo-academy");
    expect(parsed!.memberUuid.toLowerCase()).toBe(SEED_UUID);
  });

  it("round-trips a freshly-generated UUID — not just a hand-picked fixture", () => {
    const uuid = uuidv7();
    const payload = buildMemberIdPayload("any-tenant", uuid);
    const parsed = parseMemberIdPayload(payload);
    expect(parsed!.tenantSlug).toBe("any-tenant");
    expect(parsed!.memberUuid.toLowerCase()).toBe(uuid);
  });

  it("rejects slugs that contain anything outside [a-z0-9-] at payload-build time", () => {
    expect(() => buildMemberIdPayload("Demo-Academy", SEED_UUID)).toThrow();
    expect(() => buildMemberIdPayload("demo.academy", SEED_UUID)).toThrow();
    expect(() => buildMemberIdPayload("demo academy", SEED_UUID)).toThrow();
    expect(() => buildMemberIdPayload("", SEED_UUID)).toThrow();
  });

  it("rejects UUIDs that don't match the standard 8-4-4-4-12 shape", () => {
    expect(() => buildMemberIdPayload(SEED_SLUG, "not-a-uuid")).toThrow();
    expect(() => buildMemberIdPayload(SEED_SLUG, "018a6b3a7c8d7e0ab0123456789abcde")).toThrow(); // missing hyphens
    expect(() => buildMemberIdPayload(SEED_SLUG, "")).toThrow();
  });

  it("parseMemberIdPayload rejects payloads that are not ours — returns null, does not throw", () => {
    // Unknown scheme
    expect(parseMemberIdPayload("https://example.com/foo")).toBeNull();
    // Wrong scheme prefix
    expect(parseMemberIdPayload("nope://m/slug/uuid")).toBeNull();
    // Wrong host segment
    expect(parseMemberIdPayload("aqua://x/slug/uuid")).toBeNull();
    // Missing second slash
    expect(parseMemberIdPayload("aqua://m/sluguuid")).toBeNull();
    // Empty payload
    expect(parseMemberIdPayload("")).toBeNull();
  });

  it("drift — these specific format changes would break already-printed cards", () => {
    // The whole point of the format pin: any of these changes would
    // require re-issuing every card. Each one is a *regression* of
    // the approved shape, not an alternative worth supporting.
    //
    // 1. Change the scheme host from m/ to members/ — explicit
    //    format change.
    expect(buildMemberIdPayload("kicks-academy", SEED_UUID)).not.toBe(
      `aqua://members/${SEED_SLUG}/${SEED_UUID}`,
    );
    // 2. Drop the leading aqua:// scheme — would no longer be a URI.
    expect(buildMemberIdPayload("kicks-academy", SEED_UUID).startsWith("aqua://")).toBe(true);
    // 3. Reorder slug and uuid — still parseable per the regex but
    //    not the shape we approved.
    expect(buildMemberIdPayload("kicks-academy", SEED_UUID)).not.toBe(
      `aqua://m/${SEED_UUID}/kicks-academy`,
    );
    // 4. URL-encode the slash — also parseable but not the shape.
    expect(buildMemberIdPayload("kicks-academy", SEED_UUID)).not.toBe(
      `aqua://m/kicks-academy%2F${SEED_UUID}`,
    );
  });
});
