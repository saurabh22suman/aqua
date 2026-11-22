import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Ctx } from "@/lib/auth/context";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { addToWaitlist, cancelWaitlist, getWaitlistHead, promoteHead } from "@/lib/services/waitlist";

const state = vi.hoisted(() => ({ ctx: null as Ctx | null }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => state.ctx }));
import { getWaitlistHeadAction, promoteHeadAction } from "@/lib/actions/waitlist";
let f: Awaited<ReturnType<typeof fixture>>;
let second: string;
beforeAll(async () => {
  f = await fixture();
  state.ctx = { ...f.context(), permissions: new Set(["enquiries.read", "enquiries.write"]) };
  second = randomUUID();
  const person = randomUUID();
  await f.admin.query("insert into persons(id,tenant_id,full_name) values($1,$2,'Second member')", [person,f.tenantId]);
  await f.admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values($1,$2,$3,$4,'active','SECOND')", [second,f.tenantId,person,f.locationA]);
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from waitlist_entries where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});
it("passes parsed batch to head action and refuses a stale promotion under the queue lock", async () => {
  const ctx = f.context();
  expect((await addToWaitlist(ctx, {memberId:f.memberId,batchId:f.batchA})).kind).toBe("ok");
  expect((await addToWaitlist(ctx, {memberId:second,batchId:f.batchA})).kind).toBe("ok");
  const first = await getWaitlistHeadAction({ batchId: f.batchA });
  expect(first?.memberId).toBe(f.memberId);
  expect((await cancelWaitlist(ctx,{memberId:f.memberId,batchId:f.batchA})).kind).toBe("ok");
  const current = await getWaitlistHead(ctx,{batchId:f.batchA});
  expect(current?.memberId).toBe(second);
  const stale = await promoteHead(ctx,{batchId:f.batchA,expectedEntryId:first!.entryId});
  expect(stale.kind).toBe("error");
  expect((await getWaitlistHead(ctx,{batchId:f.batchA}))?.entryId).toBe(current?.entryId);
  const invalid = await promoteHeadAction({batchId:f.batchA});
  expect(invalid.kind).toBe("error");
  const promoted = await promoteHeadAction({batchId:f.batchA,expectedEntryId:current!.entryId});
  expect(promoted.kind).toBe("ok");
  expect(await getWaitlistHead(ctx,{batchId:f.batchA})).toBeNull();
});
