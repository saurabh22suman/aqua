"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  createMemberNote,
  createNoteInput,
  deleteMemberNote,
  listMemberNotes,
  updateMemberNote,
  updateNoteInput,
  type MemberNoteRow,
  type NoteMutationResult,
} from "@/lib/services/member-notes";

// U-03 — member-note actions. Standing preamble: (1) Zod parse,
// (2) permission check. Notes are staff-internal: reading rides
// members.read, authoring rides members.write.

const memberIdInput = z.object({ memberId: z.string().uuid() });
const noteIdInput = z.object({ noteId: z.string().uuid() });

export async function listMemberNotesAction(
  memberId: string,
): Promise<MemberNoteRow[]> {
  const parsed = memberIdInput.safeParse({ memberId });
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  return listMemberNotes(ctx, parsed.data.memberId);
}

export async function createMemberNoteAction(
  raw: unknown,
): Promise<NoteMutationResult> {
  const parsed = createNoteInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  return createMemberNote(ctx, parsed.data);
}

export async function updateMemberNoteAction(
  raw: unknown,
): Promise<NoteMutationResult> {
  const parsed = updateNoteInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  return updateMemberNote(ctx, parsed.data);
}

export async function deleteMemberNoteAction(
  noteId: string,
): Promise<NoteMutationResult> {
  const parsed = noteIdInput.safeParse({ noteId });
  if (!parsed.success) return { ok: false, error: "Note not found." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  return deleteMemberNote(ctx, parsed.data.noteId);
}
