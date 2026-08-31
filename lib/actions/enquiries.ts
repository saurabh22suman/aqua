"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertEnquiriesAccess } from "@/lib/auth/permissions";
import {
  addFollowUpSchema,
  bookTrialSchema,
  completeFollowUpSchema,
  convertEnquirySchema,
  createEnquirySchema,
  listEnquiriesFilterSchema,
  transitionEnquiryStageSchema,
} from "@/lib/schemas";
import {
  addFollowUp,
  bookTrial,
  completeFollowUp,
  conversionRateBySource,
  convertEnquiry,
  createEnquiry,
  getEnquiryDetail,
  listEnquiries,
  listOverdueFollowUps,
  transitionEnquiryStage,
  type EnquiryDetail,
  type EnquiryRow,
  type OverdueFollowUp,
  type SourceConversion,
} from "@/lib/services/enquiries";

const enquiryIdSchema = z.string().uuid();

export async function createEnquiryAction(raw: {
  fullName: string;
  phone?: string;
  source: string;
  notes?: string;
}): Promise<EnquiryRow> {
  const input = createEnquirySchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertEnquiriesAccess(ctx);
  return createEnquiry(ctx, input);
}

export async function listEnquiriesAction(raw: { stage?: string }): Promise<EnquiryRow[]> {
  const input = listEnquiriesFilterSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertEnquiriesAccess(ctx);
  return listEnquiries(ctx, input);
}

export async function getEnquiryDetailAction(rawEnquiryId: string): Promise<EnquiryDetail | null> {
  const enquiryId = enquiryIdSchema.parse(rawEnquiryId);
  const ctx = await requireDefaultCtx();
  assertEnquiriesAccess(ctx);
  return getEnquiryDetail(ctx, enquiryId);
}

export async function transitionEnquiryStageAction(raw: {
  enquiryId: string;
  toStage: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const input = transitionEnquiryStageSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertEnquiriesAccess(ctx);
  return transitionEnquiryStage(ctx, input);
}

export async function addFollowUpAction(raw: {
  enquiryId: string;
  dueAt: string;
  note?: string;
}): Promise<{ id: string }> {
  const input = addFollowUpSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertEnquiriesAccess(ctx);
  return addFollowUp(ctx, { ...input, dueAt: new Date(input.dueAt) });
}

export async function completeFollowUpAction(
  rawFollowUpId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const followUpId = completeFollowUpSchema.parse(rawFollowUpId);
  const ctx = await requireDefaultCtx();
  assertEnquiriesAccess(ctx);
  return completeFollowUp(ctx, followUpId);
}

export async function listOverdueFollowUpsAction(): Promise<OverdueFollowUp[]> {
  const ctx = await requireDefaultCtx();
  assertEnquiriesAccess(ctx);
  return listOverdueFollowUps(ctx);
}

export async function bookTrialAction(raw: {
  enquiryId: string;
  batchId: string;
  phone?: string;
  details: {
    dateOfBirth: string;
    gender?: string;
    locationId: string;
    medicalNotes?: string;
    guardian?: unknown;
    consents: unknown[];
  };
}): Promise<{ ok: true; memberId: string } | { ok: false; error: string }> {
  const input = bookTrialSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertEnquiriesAccess(ctx);
  return bookTrial(ctx, input);
}

export async function convertEnquiryAction(raw: {
  enquiryId: string;
  reason: string;
  newMember?: {
    dateOfBirth: string;
    gender?: string;
    locationId: string;
    medicalNotes?: string;
    guardian?: unknown;
    consents: unknown[];
  };
}): Promise<{ ok: true; memberId: string } | { ok: false; error: string }> {
  const input = convertEnquirySchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertEnquiriesAccess(ctx);
  return convertEnquiry(ctx, input);
}

export async function conversionRateBySourceAction(): Promise<SourceConversion[]> {
  const ctx = await requireDefaultCtx();
  assertEnquiriesAccess(ctx);
  return conversionRateBySource(ctx);
}
