// M3: branded (nominal) id types, scoped to exactly the id kinds this
// session's own bug list involved -- TenantId, UserId, StaffId,
// PersonId, MemberId -- not every id in the codebase. The concrete
// motivation: sessions.coach_id changed meaning from "a user id" to
// "a staff id" (C-04) and a pre-existing comparison
// (eq(sessions.coachId, ctx.userId)) kept compiling because both sides
// were plain `string`. Branding turns that exact mistake into a
// compile error -- see docs/agent-lanes.md's history for the incident.
//
// Deliberately NOT applied codebase-wide on day one: locationId,
// batchId, sessionId, enquiryId and others were never actually
// confused with each other in this codebase's history. Add a brand
// here when a real confusion happens, not speculatively.
export type TenantId = string & { readonly __brand: "TenantId" };
export type UserId = string & { readonly __brand: "UserId" };
export type StaffId = string & { readonly __brand: "StaffId" };
export type PersonId = string & { readonly __brand: "PersonId" };
export type MemberId = string & { readonly __brand: "MemberId" };

// Casts a plain string (a uuidv7() result, a DB read, a route param
// already validated by a Zod .uuid() schema) into a branded id. Not a
// runtime check -- Zod validation at the boundary is what confirms
// "this string is a real uuid"; this only tells the type system which
// *kind* of id it is, which nothing else can verify structurally.
export function asTenantId(id: string): TenantId {
  return id as TenantId;
}
export function asUserId(id: string): UserId {
  return id as UserId;
}
export function asStaffId(id: string): StaffId {
  return id as StaffId;
}
export function asPersonId(id: string): PersonId {
  return id as PersonId;
}
export function asMemberId(id: string): MemberId {
  return id as MemberId;
}
