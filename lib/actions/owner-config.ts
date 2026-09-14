"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  listOwnerVisibleConfig,
  setOwnerConfigValue,
  type OwnerConfigItem,
} from "@/db/config-owner";
import { requestConfigChange } from "@/db/config-requests";

// O-07 (docs/ops-platform-design.md §4) — the owner's registry actions.
// Standing server-action preamble: (1) parse, (2) permission check.
// Reads need settings.read; writes need settings.manage, and
// setOwnerConfigValue fails closed for anything that is not
// owner_edit.

const setValueInput = z.object({
  key: z.string().trim().min(1).max(120),
  // The value's real schema comes from the key definition; this only
  // guarantees the shape of the envelope.
  value: z.unknown(),
});

const requestChangeInput = z.object({
  key: z.string().trim().min(1).max(120),
  requestedValue: z.string().trim().min(1).max(200),
  note: z.string().trim().max(500).optional(),
});

export async function listOwnerVisibleConfigAction(): Promise<OwnerConfigItem[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.read");
  return listOwnerVisibleConfig(ctx.tenantId);
}

export async function setOwnerConfigValueAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = setValueInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid setting input." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  const result = await setOwnerConfigValue(ctx, parsed.data.key, parsed.data.value);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function requestConfigChangeAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = requestChangeInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid change request.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  const result = await requestConfigChange(ctx, parsed.data);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
