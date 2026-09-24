"use server";

import { z } from "zod";
import { MAX_MEMBER_IMPORT_BYTES } from "@/lib/services/member-import-csv";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  commitMemberImport,
  previewMemberImport,
  type MemberImportCommitResult,
  type MemberImportPreview,
} from "@/lib/services/member-import";

// PR2-C5 — member import actions. Standing preamble: (1) Zod parse,
// (2) permission check, (3) service. The file size cap is a boundary
// concern (a 2 MB CSV is ~20k rows; anything larger is a mistake, not
// an import).

const previewInput = z.object({
  csv: z
    .string()
    .min(1, "The file is empty.")
    .max(MAX_MEMBER_IMPORT_BYTES, "The file is larger than 2 MB — split it."),
});

const commitInput = previewInput.extend({
  attested: z.literal(true, { error: "Confirm consent before importing." }),
  evidenceNote: z.string().trim().max(500).optional(),
});

export type MemberImportPreviewResult =
  | { ok: true; preview: MemberImportPreview }
  | { ok: false; error: string };

export async function previewMemberImportAction(
  raw: unknown,
): Promise<MemberImportPreviewResult> {
  // (1) parse
  const parsed = previewInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid file.",
    };
  }
  // (2) permission: member management
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  // (3) service
  const preview = await previewMemberImport(ctx, parsed.data.csv);
  return { ok: true, preview };
}

export type MemberImportCommitActionResult =
  | { ok: true; result: MemberImportCommitResult }
  | { ok: false; error: string };

export async function commitMemberImportAction(
  raw: unknown,
): Promise<MemberImportCommitActionResult> {
  // (1) parse
  const parsed = commitInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid file.",
    };
  }
  // (2) permission: member management
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  // (3) service
  try {
    const result = await commitMemberImport(ctx, parsed.data.csv, {
      attested: parsed.data.attested,
      evidenceNote: parsed.data.evidenceNote,
    });
    return { ok: true, result };
  } catch {
    return { ok: false, error: "Import failed. No rows were saved; check member codes and retry." };
  }
}
