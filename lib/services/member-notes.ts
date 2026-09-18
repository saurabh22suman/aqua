import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { memberNotes } from "@/db/schema/member-notes";
import { members } from "@/db/schema/people";
import { users } from "@/db/schema/users";
import { persons } from "@/db/schema/people";
import { tenantMemberships } from "@/db/schema/memberships";
import { writeAudit } from "@/lib/audit/write";
import { locationVisible, resolveLocationAccess } from "@/lib/services/location-access";
import { asMemberId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// U-03 — member notes. Staff-authored, tenant-scoped, audited.
// Reads and writes go through the member's location check (O-08):
// a location-scoped caller cannot see or write a note on a member
// outside their locations. Cross-tenant access is RLS's job.

export type MemberNoteRow = {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
};

export type NoteMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export const noteBodySchema = z.string().trim().min(1, "A note cannot be empty.").max(4000);

export const createNoteInput = z.object({
  memberId: z.string().uuid(),
  body: noteBodySchema,
});

export const updateNoteInput = z.object({
  noteId: z.string().uuid(),
  body: noteBodySchema,
});

const createInput = createNoteInput;

export async function listMemberNotes(
  ctx: ActionCtx,
  memberId: string,
): Promise<MemberNoteRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const allowed = await memberVisible(tx, ctx, memberId);
    if (!allowed) return [];

    const rows = await tx
      .select({
        id: memberNotes.id,
        body: memberNotes.body,
        createdAt: memberNotes.createdAt,
        updatedAt: memberNotes.updatedAt,
        edited: sql<boolean>`${memberNotes.updatedAt} > ${memberNotes.createdAt}`,
        authorName: persons.fullName,
      })
      .from(memberNotes)
      .leftJoin(
        tenantMemberships,
        and(
          eq(tenantMemberships.userId, memberNotes.createdBy),
          eq(tenantMemberships.tenantId, memberNotes.tenantId),
        ),
      )
      .leftJoin(users, eq(users.id, tenantMemberships.userId))
      .leftJoin(persons, eq(persons.id, users.personId))
      .where(
        and(
          eq(memberNotes.tenantId, ctx.tenantId),
          eq(memberNotes.memberId, asMemberId(memberId)),
          isNull(memberNotes.deletedAt),
        ),
      )
      .orderBy(desc(memberNotes.createdAt));

    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      authorName: r.authorName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      edited: r.edited,
    }));
  });
}

export async function createMemberNote(
  ctx: ActionCtx,
  raw: unknown,
): Promise<NoteMutationResult> {
  const parsed = createInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const allowed = await memberVisible(tx, ctx, parsed.data.memberId);
    if (!allowed) return { ok: false, error: "Member not found." };

    const [row] = await tx
      .insert(memberNotes)
      .values({
        tenantId: ctx.tenantId,
        memberId: asMemberId(parsed.data.memberId),
        body: parsed.data.body,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: memberNotes.id });
    if (!row) return { ok: false, error: "The note could not be saved." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "member_note.create",
      entityType: "member_note",
      entityId: row.id,
      after: { memberId: parsed.data.memberId, chars: parsed.data.body.length },
      requestId: ctx.requestId,
    });
    return { ok: true, id: row.id };
  });
}

export async function updateMemberNote(
  ctx: ActionCtx,
  raw: unknown,
): Promise<NoteMutationResult> {
  const parsed = updateNoteInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const existing = await findNote(tx, ctx, parsed.data.noteId);
    if (!existing) return { ok: false, error: "Note not found." };
    const allowed = await memberVisible(tx, ctx, existing.memberId);
    if (!allowed) return { ok: false, error: "Note not found." };

    await tx
      .update(memberNotes)
      .set({ body: parsed.data.body, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(eq(memberNotes.id, parsed.data.noteId), eq(memberNotes.tenantId, ctx.tenantId)),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "member_note.update",
      entityType: "member_note",
      entityId: parsed.data.noteId,
      before: { body: existing.body },
      after: { body: parsed.data.body },
      changedFields: ["body"],
      requestId: ctx.requestId,
    });
    return { ok: true, id: parsed.data.noteId };
  });
}

export async function deleteMemberNote(
  ctx: ActionCtx,
  noteId: string,
): Promise<NoteMutationResult> {
  const parsed = z.string().uuid().safeParse(noteId);
  if (!parsed.success) return { ok: false, error: "Note not found." };
  return withTenant(ctx.tenantId, async (tx) => {
    const existing = await findNote(tx, ctx, parsed.data);
    if (!existing) return { ok: false, error: "Note not found." };
    const allowed = await memberVisible(tx, ctx, existing.memberId);
    if (!allowed) return { ok: false, error: "Note not found." };

    await tx
      .update(memberNotes)
      .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(eq(memberNotes.id, parsed.data), eq(memberNotes.tenantId, ctx.tenantId)),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "member_note.delete",
      entityType: "member_note",
      entityId: parsed.data,
      before: { body: existing.body },
      requestId: ctx.requestId,
    });
    return { ok: true, id: parsed.data };
  });
}

async function findNote(
  tx: TenantTx,
  ctx: ActionCtx,
  noteId: string,
): Promise<{ id: string; memberId: string; body: string } | null> {
  const rows = await tx
    .select({ id: memberNotes.id, memberId: memberNotes.memberId, body: memberNotes.body })
    .from(memberNotes)
    .where(
      and(
        eq(memberNotes.id, noteId),
        eq(memberNotes.tenantId, ctx.tenantId),
        isNull(memberNotes.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function memberVisible(
  tx: TenantTx,
  ctx: ActionCtx,
  memberId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ locationId: members.locationId })
    .from(members)
    .where(
      and(
        eq(members.id, asMemberId(memberId)),
        eq(members.tenantId, ctx.tenantId),
        isNull(members.deletedAt),
      ),
    )
    .limit(1);
  const member = rows[0];
  if (!member) return false;
  const access = await resolveLocationAccess(tx, ctx);
  return locationVisible(access, member.locationId);
}
