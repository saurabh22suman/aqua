import { z } from "zod";

// What the offline queue may hold.
//
// While a device is offline this app can still write exactly one kind
// of thing: an attendance mark. The queue is the boundary that keeps
// that true, so the shape is validated at the door: a payment, a fee
// change, a staff action, or anything malformed is refused before it
// reaches storage.
//
// `.strict()` matters: an unexpected key is a sign the entry was not
// produced by this app's own attendance path, and it is refused rather
// than stored.

export const offlineQueueEntrySchema = z.object({
  /** Idempotency key for the server-side mark. */
  clientId: z.string().min(1).max(128),
  /** The session the mark belongs to. */
  sessionId: z.string().min(1).max(128),
  /** The member the mark is about. */
  memberId: z.string().min(1).max(128),
  /** Attendance only — never a payment or a state change. */
  status: z.enum(["present", "absent", "late"]),
  /** When the person marked it. */
  savedAt: z.number().int().nonnegative(),
  /** How many times the sync has been tried. */
  attempts: z.number().int().nonnegative().max(1000),
  /** The signed-in offline scope this mark belongs to. */
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  /** The offline identity's expiry — the mark dies with the session. */
  expiresAt: z.number().int().positive(),
});

export type OfflineQueueEntry = z.infer<typeof offlineQueueEntrySchema>;

/** The refusal message used when an entry is not an attendance mark. */
export const QUEUE_ENTRY_REFUSED = "This attendance mark cannot be saved offline.";
