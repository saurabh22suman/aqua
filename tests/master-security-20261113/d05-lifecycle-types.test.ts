import { expect, it } from "vitest";
import { cancelSession } from "@/lib/services/session-lifecycle";
import { asTenantId, asUserId } from "@/lib/ids";

const tenantId = asTenantId("00000000-0000-4000-8000-000000000001");
const userId = asUserId("00000000-0000-4000-8000-000000000002");
if (false) {
  // @ts-expect-error A lifecycle mutation needs a human or explicit system actor.
  void cancelSession({ tenantId }, "00000000-0000-4000-8000-000000000003");
  // @ts-expect-error A system actor cannot also be a human actor.
  void cancelSession({ tenantId, userId, systemActor: true }, "00000000-0000-4000-8000-000000000003");
}
it("keeps lifecycle actor compile-time assertions in the typecheck", () => expect(tenantId).toBeTruthy());
