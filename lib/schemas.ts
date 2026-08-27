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

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type MarkRegisterInput = z.infer<typeof markRegisterSchema>;
