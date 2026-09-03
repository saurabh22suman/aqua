import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { enrolments } from "@/db/schema/scheduling";
import { batches, programs } from "@/db/schema/programs";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";

// B3 — a member created through reception's add-member form, or
// produced by converting an enquiry that never had a trial booked,
// previously had no path to a batch at all: enrolMember() (this file's
// companion in register.ts) had exactly one reachable caller
// (bookTrial). This is the read side of the fix — what the member
// detail page shows to decide between "enrol" and "already enrolled".

export type MemberEnrolment = {
  batchId: string;
  batchName: string;
  programName: string;
  enrolledOn: string;
};

export async function listMemberEnrolments(
  ctx: ActionCtx,
  memberId: string,
): Promise<MemberEnrolment[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        batchId: batches.id,
        batchName: batches.name,
        programName: programs.name,
        enrolledOn: enrolments.enrolledOn,
      })
      .from(enrolments)
      .innerJoin(batches, eq(batches.id, enrolments.batchId))
      .innerJoin(programs, eq(programs.id, batches.programId))
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(enrolments.memberId, asMemberId(memberId)),
          isNull(batches.deletedAt),
        ),
      )
      .orderBy(batches.name),
  );
}
