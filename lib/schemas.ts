import { z } from "zod";

// C-05: a consent grant, as captured at member registration. Shape
// only -- the business rule "processing is required" lives in
// createMember (lib/services/register.ts), not here.
export const consentGrantSchema = z.object({
  purpose: z.enum(["processing", "photography", "communications"]),
  policyVersion: z.string().min(1),
  evidence: z.object({
    channel: z.string().min(1),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
  }),
});

export const guardianInputSchema = z.union([
  z.object({ existingPersonId: z.string().uuid(), relationship: z.string().min(1).max(50) }),
  z.object({
    fullName: z.string().min(1).max(200),
    phone: z.string().optional(),
    relationship: z.string().min(1).max(50),
  }),
]);

export const createMemberSchema = z.object({
  fullName: z.string().min(1).max(200),
  // Mandatory, not optional -- C-05. Minor status is derived from this
  // server-side (isMinor, lib/time/tz.ts); "unknown" cannot be treated
  // as "adult" by omitting it.
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(["male", "female", "other"]).optional(),
  locationId: z.string().uuid(),
  memberCode: z.string().min(1).max(50),
  medicalNotes: z.string().max(2000).optional(),
  guardian: guardianInputSchema.optional(),
  consents: z.array(consentGrantSchema).min(1),
  witnessedByUserId: z.string().uuid().optional(),
});

export const enrolSchema = z.object({
  memberId: z.string().uuid(),
  batchId: z.string().uuid(),
  enrolledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const sessionIdSchema = z.string().uuid();
export const phoneNumberSchema = z.string().min(8).max(20);

export const markAttendanceSchema = z.object({
  sessionId: z.string().uuid(),
  memberId: z.string().uuid(),
  status: z.enum(["present", "absent", "late"]).default("present"),
  clientId: z.string().min(8).max(100),
});

export const markRegisterSchema = z.object({
  sessionId: z.string().uuid(),
  entries: z
    .array(
      z.object({
        memberId: z.string().uuid(),
        status: z.enum(["present", "absent", "late"]).default("present"),
        clientId: z.string().min(8).max(100),
      }),
    )
    .min(1)
    .max(60),
});

export const createProgramSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const createBatchSchema = z.object({
  programId: z.string().uuid(),
  name: z.string().min(1).max(200),
  capacity: z.number().int().positive(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  coachId: z.string().uuid().optional(),
});

export const deleteProgramSchema = z.string().uuid();
export const deleteBatchSchema = z.string().uuid();

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type MarkRegisterInput = z.infer<typeof markRegisterSchema>;
export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
