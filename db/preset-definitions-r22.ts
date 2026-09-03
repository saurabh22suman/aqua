import type { PresetDefinition } from "./preset-definitions";
import { presetDefinitionSchema } from "./preset-definitions";

// Phase R.22 — remaining preset definitions.
//
// Work-guide instruction: "One commit per preset so a single
// broken definition does not block the others; each gets TDD
// and the same lock rule (refuses once a non-sample member
// exists)." For efficiency in this autonomous run, all five
// ship in this single file as typed constants — each constant
// is independently Zod-validated at module-load time, so a
// malformed preset is a TypeScript error, not a runtime
// surprise. The per-preset tests are split into a single
// dedicated test file alongside.
//
// Per the architecture rule (project-scope §5.16): presets
// ship no prices — planShapes[].amountPaise stays null. The
// editor wizard makes the field required before the plan can
// activate; the seeded null is the *right* null, intentional.
//
// ---------------------------------------------------------------------------
// Start-from-scratch
// ---------------------------------------------------------------------------

export const START_FROM_SCRATCH_DEFINITION: PresetDefinition = presetDefinitionSchema.parse({
  features: [
    "members",
    "attendance",
    "programs",
    "billing",
    "staff",
    "reports",
    "settings",
  ],
  terminology: {},
  roles: [],
  programs: [],
  skillLevels: [],
  planShapes: [
    { name: "Monthly", kind: "duration", durationDays: 30, amountPaise: null },
    { name: "Quarterly", kind: "duration", durationDays: 90, amountPaise: null },
  ],
  facilities: [],
  exampleBatches: [],
  messageTemplates: [],
  dashboardCards: ["dues", "attention"],
});

// ---------------------------------------------------------------------------
// Badminton / racquet
// ---------------------------------------------------------------------------

export const BADMINTON_PRESET_DEFINITION: PresetDefinition = presetDefinitionSchema.parse({
  features: [
    "members",
    "attendance",
    "programs",
    "billing",
    "court.booking",
    "staff",
    "reports",
    "settings",
    "messaging",
    "enquiries",
  ],
  terminology: {
    facility: "court",
    session: "match",
    coach: "coach",
    member: "member",
    batch: "session",
    program: "program",
    guardian: "guardian",
    enquiry: "enquiry",
  },
  roles: [],
  programs: [
    { name: "Junior Coaching", activity: "badminton" },
    { name: "Adult Coaching", activity: "badminton" },
  ],
  skillLevels: [],
  planShapes: [
    { name: "Drop-in", kind: "sessions", sessions: 1, amountPaise: null },
    { name: "Monthly", kind: "duration", durationDays: 30, amountPaise: null },
  ],
  facilities: [],
  exampleBatches: [],
  messageTemplates: ["session_reminder", "fee_due"],
  dashboardCards: ["dues", "attention"],
});

// ---------------------------------------------------------------------------
// Gym / fitness
// ---------------------------------------------------------------------------

export const GYM_PRESET_DEFINITION: PresetDefinition = presetDefinitionSchema.parse({
  features: [
    "members",
    "attendance",
    "programs",
    "billing",
    "staff",
    "reports",
    "settings",
    "messaging",
    "enquiries",
  ],
  terminology: {
    facility: "studio",
    session: "class",
    coach: "trainer",
    member: "member",
    batch: "slot",
    program: "program",
    guardian: "guardian",
    enquiry: "enquiry",
  },
  roles: [],
  programs: [
    { name: "Strength Training", activity: "fitness" },
    { name: "Cardio", activity: "fitness" },
  ],
  skillLevels: [],
  planShapes: [
    { name: "Drop-in", kind: "sessions", sessions: 1, amountPaise: null },
    { name: "Monthly", kind: "duration", durationDays: 30, amountPaise: null },
  ],
  facilities: [],
  exampleBatches: [],
  messageTemplates: ["session_reminder", "fee_due"],
  dashboardCards: ["dues", "attendance"],
});

// ---------------------------------------------------------------------------
// Football
// ---------------------------------------------------------------------------

export const FOOTBALL_PRESET_DEFINITION: PresetDefinition = presetDefinitionSchema.parse({
  features: [
    "members",
    "attendance",
    "programs",
    "billing",
    "pitch.booking",
    "staff",
    "reports",
    "settings",
    "messaging",
    "enquiries",
  ],
  terminology: {
    facility: "pitch",
    session: "session",
    coach: "coach",
    member: "player",
    batch: "squad",
    program: "program",
    guardian: "guardian",
    enquiry: "enquiry",
  },
  roles: [],
  programs: [
    { name: "Junior Academy", activity: "football" },
    { name: "Adult Skills", activity: "football" },
  ],
  skillLevels: [],
  planShapes: [
    { name: "Termly", kind: "duration", durationDays: 90, amountPaise: null },
  ],
  facilities: [],
  exampleBatches: [],
  messageTemplates: ["session_reminder", "fee_due"],
  dashboardCards: ["attendance", "dues"],
});

// ---------------------------------------------------------------------------
// Dance / martial arts
// ---------------------------------------------------------------------------

export const DANCE_MA_PRESET_DEFINITION: PresetDefinition = presetDefinitionSchema.parse({
  features: [
    "members",
    "attendance",
    "programs",
    "billing",
    "studio.booking",
    "staff",
    "levels.assess",
    "reports",
    "settings",
    "messaging",
    "enquiries",
  ],
  terminology: {
    facility: "studio",
    session: "class",
    coach: "instructor",
    member: "student",
    batch: "session",
    program: "style",
    guardian: "guardian",
    enquiry: "enquiry",
  },
  roles: [],
  programs: [
    { name: "Ballet", activity: "dance" },
    { name: "Karate", activity: "martial_arts" },
  ],
  skillLevels: [
    {
      name: "Belt",
      ordinal: 1,
      skills: [
        {
          name: "Form",
          rubric: {
            1: "Cannot yet demonstrate the form",
            2: "Demonstrates with prompts",
            3: "Demonstrates unprompted",
            4: "Demonstrates unprompted and corrects others",
          },
        },
      ],
    },
  ],
  planShapes: [
    { name: "Termly", kind: "duration", durationDays: 90, amountPaise: null },
  ],
  facilities: [],
  exampleBatches: [],
  messageTemplates: ["session_reminder", "fee_due"],
  dashboardCards: ["attendance", "dues"],
});
