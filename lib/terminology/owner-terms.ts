import { DEFAULT_TERMS, resolveTerm, type TermKey, type TerminologyState } from "@/lib/terminology/keys";

const CORE_TERMS = ["member", "program", "batch", "session", "facility"] as const satisfies readonly TermKey[];

/** Build a presentation-only view, preserving stored values and non-core terms. */
export function ownerTerminology(state: TerminologyState): TerminologyState {
  const overrides = { ...state.overrides };
  for (const key of CORE_TERMS) {
    overrides[key] = { ...state.overrides[key], [state.locale]: { ...DEFAULT_TERMS[state.locale][key] } };
  }
  return { ...state, overrides };
}

/** Owner workspace vocabulary only; stored overrides and other surfaces are untouched. */
export function ownerTerm(state: TerminologyState, key: TermKey, count: 1 | "other"): string {
  return resolveTerm(ownerTerminology(state), key, count);
}
