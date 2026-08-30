import { z } from "zod";

export const createMemberSchema = z.object({
  fullName: z.string().min(1).max(200),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  locationId: z.string().uuid(),
  memberCode: z.string().min(1).max(50),
  medicalNotes: z.string().max(2000).optional(),
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
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type MarkRegisterInput = z.infer<typeof markRegisterSchema>;
export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
