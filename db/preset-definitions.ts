import { z } from "zod";

// Phase 2.1 — preset definition shape per architecture §7.4.
//
// A preset is a versioned bundle of entitlements plus seed data,
// applied once when a tenant is created. The JSON shape stored
// inside `presets.definition` is what applyPreset() walks (F-20,
// Phase 2.2). 2.1 *writes* the data; 2.2 wires the engine. Split
// keeps each PR reviewable.
//
// Why a Zod schema here, not just any: the JSON travels from
// the SQL row → service layer → caller. Without a schema it is
// `Record<string, unknown>` everywhere — every consumer would have
// to reinvent the shape check. Parsing once at the boundary keeps
// downstream code typed and the test suite's structural assertions
// ("you forgot a `messageTemplates` key" etc.) available.
//
// Things deliberately absent from the schema:
//   - Prices. `planShapes[].amountPaise` is `z.null()` literally —
//     no number alternative. A seeded price a club forgets to
//     change becomes a support ticket and a billing dispute.
//     Architecture §7.2: amount null; the wizard makes the field
//     required before the plan can activate.
//   - `roles[].key`. The apply engine slugifies `name` into `key`.
//     The preset author writes display text; the engine produces
//     the key. Storing both would invite drift.
//   - `homePath` / `homeOrdinal` on roles. Same reasoning — the
//     engine fills these from the role it knows about (existing
//     owner/admin/coach roles already have homePath; vertical-added
//     roles land on `/owner` until the engine learns otherwise).
//   - `is_sample` flagging. 2.3's task on the engine, not on
//     data shape — every seeded batch/program is sample by default,
//     tagged after the fact.

const dashedTime = /^\d{2}:\d{2}$/; // ISO-8601 local time as HH:MM

const planShapeBase = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["duration", "sessions"]),
});

const durationPlanShape = planShapeBase.extend({
  kind: z.literal("duration"),
  durationDays: z.number().int().positive(),
  amountPaise: z.null(),
});

const sessionsPlanShape = planShapeBase.extend({
  kind: z.literal("sessions"),
  sessions: z.number().int().positive(),
  amountPaise: z.null(),
});

export const planShapeSchema = z.discriminatedUnion("kind", [
  durationPlanShape,
  sessionsPlanShape,
]);

export const skillRubricSchema = z.object({
  1: z.string().trim().min(1),
  2: z.string().trim().min(1),
  3: z.string().trim().min(1),
  4: z.string().trim().min(1),
});

export const skillSchema = z.object({
  name: z.string().trim().min(1).max(120),
  rubric: skillRubricSchema,
});

export const skillLevelSchema = z.object({
  name: z.string().trim().min(1).max(60),
  ordinal: z.number().int().positive(),
  skills: z.array(skillSchema).min(1),
});

export const programSchema = z.object({
  name: z.string().trim().min(1).max(120),
  activity: z.string().trim().min(1).max(60),
});

export const facilitySubUnitSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const facilitySchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["pool", "court", "turf", "studio", "field"]),
  capacity: z.number().int().positive(),
  subUnits: z.array(facilitySubUnitSchema).default([]),
});

export const roleSpecSchema = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: z.array(z.string().trim().min(1)).min(1),
});

export const exampleBatchSchema = z.object({
  // exampleBatches attach to a program by name — the engine's
  // exampleBatches resolution does an exact-string match. Letting
  // the definition author name batches with descriptive labels
  // ("Beginners MWF 06:00") meant the engine had to fuzzy-match,
  // which is brittle. The explicit programName field is the
  // minimal way to make the linkage readable.
  programName: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: z.string().regex(dashedTime),
  capacity: z.number().int().positive(),
});

export const presetDefinitionSchema = z.object({
  features: z.array(z.string().trim().min(1)).min(1),
  terminology: z.record(z.string().trim().min(1), z.string().trim().min(1)),
  roles: z.array(roleSpecSchema).default([]),
  programs: z.array(programSchema).default([]),
  skillLevels: z.array(skillLevelSchema).default([]),
  planShapes: z.array(planShapeSchema).default([]),
  facilities: z.array(facilitySchema).default([]),
  exampleBatches: z.array(exampleBatchSchema).default([]),
  messageTemplates: z.array(z.string().trim().min(1)).default([]),
  dashboardCards: z.array(z.string().trim().min(1)).default([]),
});

export type PresetDefinition = z.output<typeof presetDefinitionSchema>;
export type PresetPlanShape = z.output<typeof planShapeSchema>;
export type PresetSkillLevel = z.output<typeof skillLevelSchema>;
export type PresetFacility = z.output<typeof facilitySchema>;

// Two definitions written here (2.1). The fixtures compile against
// the schema at module-load time — a typo in the JSON below
// surfaces as a TypeScript error, not a runtime surprise. The seed
// migration is a separate file (db/migrations/…) that pins the same
// shape into SQL; one source of truth keeps them in lockstep.

// ---------------------------------------------------------------------------
// Swimming academy (architecture §7.4, project-scope §5.16, work-guide 2.1)
// ---------------------------------------------------------------------------

export const SWIMMING_PRESET_DEFINITION: PresetDefinition = {
  features: [
    "members",
    "attendance",
    "programs",
    "billing",
    "pool.booking",
    "swim.levels",
    "staff",
    "reports",
    "settings",
    "messaging",
    "enquiries",
  ],
  terminology: {
    student: "swimmer",
    batch: "batch",
    lane: "lane",
    coach: "coach",
    level: "level",
  },
  // Two vertical-specific roles. The five standard roles
  // (owner/admin/accountant/receptionist/coach/worker) are seeded
  // separately on tenant creation by seedRoleTemplates; the
  // preset's `roles` array is the vertical's *additional* roles,
  // never a re-seed of the standard ones.
  roles: [
    {
      name: "Head coach",
      permissions: [
        "members.read",
        "members.write",
        "attendance.read",
        "attendance.mark",
        "programs.read",
        "levels.read",
        "levels.assess",
      ],
    },
    {
      name: "Assistant coach",
      permissions: [
        "members.read",
        "attendance.read",
        "attendance.mark",
        "programs.read",
        "levels.read",
        "levels.assess",
      ],
    },
  ],
  programs: [
    { name: "Learn to swim", activity: "swimming" },
    { name: "Stroke development", activity: "swimming" },
    { name: "Junior competitive", activity: "swimming" },
  ],
  skillLevels: [
    {
      name: "Beginner",
      ordinal: 1,
      skills: [
        {
          name: "Water confidence",
          rubric: {
            1: "Holds pool edge; needs constant reassurance",
            2: "Floats with support; hesitant to submerge",
            3: "Floats independently; submerges and resurfaces at will",
            4: "Comfortable in deep end; relaxed breathing pattern",
          },
        },
        {
          name: "Freestyle",
          rubric: {
            1: "Cannot coordinate arms and legs",
            2: "Short bursts with breathing breaks",
            3: "Continuous laps with bilateral breathing",
            4: "Efficient stroke, 25 m unbroken at steady pace",
          },
        },
      ],
    },
    {
      name: "Intermediate",
      ordinal: 2,
      skills: [
        {
          name: "Freestyle",
          rubric: {
            1: "Short bursts with breathing breaks",
            2: "Continuous laps with bilateral breathing",
            3: "50 m unbroken under one minute",
            4: "Efficient stroke with flip turn",
          },
        },
        {
          name: "Backstroke",
          rubric: {
            1: "Cannot coordinate arm stroke",
            2: "Continuous 25 m with arm breaks",
            3: "50 m with body rotation",
            4: "Efficient 100 m at steady pace",
          },
        },
        {
          name: "Breaststroke",
          rubric: {
            1: "Cannot coordinate kick",
            2: "Short 15 m with breathing breaks",
            3: "Continuous 25 m with timing",
            4: "Efficient 50 m with glide",
          },
        },
        {
          name: "Breathing",
          rubric: {
            1: "Mouth above water with strain",
            2: "Comfortable exhale underwater",
            3: "Bilateral rotation; rhythmic inhale",
            4: "Adaptable to varied conditions and effort",
          },
        },
      ],
    },
    {
      name: "Advanced",
      ordinal: 3,
      skills: [
        {
          name: "Butterfly",
          rubric: {
            1: "Cannot coordinate dolphin kick",
            2: "Short 25 m with breathing breaks",
            3: "50 m unbroken",
            4: "Sustained butterfly with strong rhythm",
          },
        },
        {
          name: "Endurance",
          rubric: {
            1: "100 m continuous",
            2: "400 m continuous",
            3: "1 km continuous",
            4: "2 km continuous at conversational pace",
          },
        },
      ],
    },
  ],
  // amountPaise is `null` BY DESIGN (architecture §7.4). The
  // onboarding wizard makes the field required before the plan
  // can activate — a seeded INR 3,000 that a club forgets to
  // change becomes a billing dispute the day they invoice the
  // first swimmer.
  planShapes: [
    { name: "Monthly", kind: "duration", durationDays: 30, amountPaise: null },
    { name: "Quarterly", kind: "duration", durationDays: 90, amountPaise: null },
  ],
  facilities: [
    {
      name: "Main pool",
      kind: "pool",
      capacity: 40,
      subUnits: [
        { name: "Lane 1" },
        { name: "Lane 2" },
        { name: "Lane 3" },
        { name: "Lane 4" },
      ],
    },
  ],
  exampleBatches: [
    // 2.3 will set the is_sample flag on rows seeded by presets
    // (every seeded batch is sample by default, per architecture
    // §7.4 rule 4). The flag is owned by the engine; the data
    // shape here stays shape-only.
    {
      programName: "Learn to swim",
      name: "Beginners MWF 06:00",
      daysOfWeek: [1, 3, 5],
      startTime: "06:00",
      capacity: 16,
    },
    {
      programName: "Junior competitive",
      name: "Junior TTS 17:00",
      daysOfWeek: [2, 4, 6],
      startTime: "17:00",
      capacity: 16,
    },
  ],
  messageTemplates: ["session_reminder", "fee_due", "swim_progress_note"],
  dashboardCards: ["todays_lanes", "dues", "attention"],
};

// ---------------------------------------------------------------------------
// Multi-sport club (architecture §7.4, project-scope §5.16)
// ---------------------------------------------------------------------------
// Multi-sport deliberately ships with no vertical-specific content:
// programs, skill levels, facilities, example batches are all
// empty arrays. The point of the preset is "everything is
// available, nothing specific is loaded — add a sport from the
// catalogue when you know which one." The apply engine writes the
// standard five roles plus the staff/invite role; no extra role
// templates at the multi-sport baseline.

export const MULTI_SPORT_PRESET_DEFINITION: PresetDefinition = {
  features: [
    "members",
    "attendance",
    "programs",
    "billing",
    "pool.booking",
    "staff",
    "reports",
    "settings",
    "messaging",
    "enquiries",
  ],
  terminology: {
    student: "member",
    batch: "batch",
    lane: "facility",
    coach: "coach",
    level: "level",
  },
  roles: [],
  programs: [],
  skillLevels: [],
  planShapes: [
    { name: "Monthly", kind: "duration", durationDays: 30, amountPaise: null },
    { name: "Quarterly", kind: "duration", durationDays: 90, amountPaise: null },
  ],
  facilities: [],
  exampleBatches: [],
  messageTemplates: ["session_reminder", "fee_due"],
  dashboardCards: ["dues", "attention"],
};
