import { enquiries, enquiryFollowUps } from "@/db/schema/enquiries";
import { asMemberId } from "@/lib/ids";
import { historyId } from "./keys";
import type { WriteContext } from "./write-context";

// The enquiries that came in, and the follow-ups that are still open.
//
// Invented names and invented phone numbers, in a range the demo seed
// does not use, so a synthetic enquiry is never mistaken for a seeded
// member. The stage mix is the closed set the database enforces, and a
// converted enquiry points at a real member.

export async function writeEnquiries(ctx: WriteContext): Promise<void> {
  const { tx, tenantId, state, plan, counters, existing } = ctx;

  for (const enquiry of plan.enquiries) {
    const rows = await tx
      .insert(enquiries)
      .values({
        id: historyId(state.tenant.id, "enquiry", enquiry.key),
        tenantId,
        fullName: enquiry.fullName,
        phone: enquiry.phone,
        source: enquiry.source,
        stage: enquiry.stage,
        memberId: enquiry.memberId ? asMemberId(enquiry.memberId) : null,
        locationId: state.primaryLocationId,
        notes: enquiry.notes,
        createdAt: new Date(enquiry.createdAtIso),
        updatedAt: new Date(enquiry.createdAtIso),
      })
      .onConflictDoNothing()
      .returning({ id: enquiries.id });
    if (rows.length > 0) {
      counters.enquiries += 1;
    } else {
      existing.enquiries += 1;
    }
    for (const followUp of enquiry.followUps) {
      const followRows = await tx
        .insert(enquiryFollowUps)
        .values({
          id: historyId(state.tenant.id, "enquiry-follow-up", followUp.key),
          tenantId,
          enquiryId: historyId(state.tenant.id, "enquiry", enquiry.key),
          dueAt: new Date(followUp.dueAtIso),
          doneAt: followUp.doneAtIso ? new Date(followUp.doneAtIso) : null,
          note: followUp.note,
        })
        .onConflictDoNothing()
        .returning({ id: enquiryFollowUps.id });
      counters.followUps += followRows.length;
    }
  }
}
