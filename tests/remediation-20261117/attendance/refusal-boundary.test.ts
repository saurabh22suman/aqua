import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../../remediation-20261112/fixture";
import { markAttendance } from "@/lib/services/attendance-mark";
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { if (f) await f.cleanup(); });
it("treats a missing resource as review only after checking live authority", async () => {
  const input = { sessionId: randomUUID(), memberId: f.memberId, clientId: randomUUID(), status: "present" as const };
  await expect(markAttendance(f.context(f.receptionistId, "receptionist"), input)).rejects.toMatchObject({ name: "AttendanceReviewRequired" });
  await f.admin.query("update tenant_memberships set status='revoked' where tenant_id=$1 and user_id=$2", [f.tenantId, f.receptionistId]);
  await expect(markAttendance(f.context(f.receptionistId, "receptionist"), input)).rejects.not.toMatchObject({ name: "AttendanceReviewRequired" });
});
