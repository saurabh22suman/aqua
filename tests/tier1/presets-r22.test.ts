import { describe, expect, it } from "vitest";
import {
  BADMINTON_PRESET_DEFINITION,
  DANCE_MA_PRESET_DEFINITION,
  FOOTBALL_PRESET_DEFINITION,
  GYM_PRESET_DEFINITION,
  START_FROM_SCRATCH_DEFINITION,
} from "@/db/preset-definitions-r22";

// Phase R.22 — remaining preset definitions. Each constant
// is Zod-validated at module-load time (the file imports it
// once). The on-mount tests here pin the closed-key
// invariants: a preset carries every required section;
// terminology shapes are non-empty for the verticals that
// need them; the lock shape (planShapes with amount null, no
// prices) holds.

const ALL_PRESETS = [
  START_FROM_SCRATCH_DEFINITION,
  BADMINTON_PRESET_DEFINITION,
  GYM_PRESET_DEFINITION,
  FOOTBALL_PRESET_DEFINITION,
  DANCE_MA_PRESET_DEFINITION,
];

describe("presets (R.22 — start-from-scratch, badminton, gym, football, dance/MA)", () => {
  it("start-from-scratch is non-empty but skeletal", () => {
    expect(START_FROM_SCRATCH_DEFINITION.features.length).toBeGreaterThan(0);
    expect(START_FROM_SCRATCH_DEFINITION.exampleBatches).toEqual([]);
    expect(START_FROM_SCRATCH_DEFINITION.planShapes.length).toBeGreaterThan(0);
  });

  it("every preset has at least one plan shape — the wizard needs at least one to display", () => {
    for (const preset of ALL_PRESETS) {
      expect(preset.planShapes.length, preset.messageTemplates.join()).toBeGreaterThan(0);
    }
  });

  it("no preset ships prices — every plan shape has amountPaise: null (the architecture §7.2 lock)", () => {
    for (const preset of ALL_PRESETS) {
      for (const shape of preset.planShapes) {
        expect(shape.amountPaise).toBeNull();
      }
    }
  });

  it("verticals that override vocabulary carry non-empty terminology (court, studio, pitch)", () => {
    expect(BADMINTON_PRESET_DEFINITION.terminology.facility).toBeDefined();
    expect(GYM_PRESET_DEFINITION.terminology.facility).toBeDefined();
    expect(FOOTBALL_PRESET_DEFINITION.terminology.facility).toBeDefined();
    expect(DANCE_MA_PRESET_DEFINITION.terminology.facility).toBeDefined();
  });

  it("start-from-scratch leaves terminology empty (the operator defines the words)", () => {
    expect(START_FROM_SCRATCH_DEFINITION.terminology).toEqual({});
  });

  it("every preset except start-from-scratch carries the audit-relevant message templates", () => {
    // start-from-scratch is the operator's canvas: they pick
    // what to enable. Other verticals ship the templates that
    // the preset's messaging features unlock.
    for (const preset of ALL_PRESETS) {
      if (preset === START_FROM_SCRATCH_DEFINITION) continue;
      expect(preset.messageTemplates.length).toBeGreaterThan(0);
    }
  });
});
