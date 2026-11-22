export const PUBLIC_SHOWCASE_FIELDS = [
  "chosenName",
  "clubName",
  "achievements",
] as const;

export type PublicAchievement = { label: string; level: string };

export type PublicShowcaseView = {
  chosenName: string;
  clubName: string;
  achievements: PublicAchievement[];
};

const MAX_CHOSEN_NAME = 60;
const MAX_CLUB_NAME = 200;
const MAX_ACHIEVEMENT_LABEL = 120;
const MAX_ACHIEVEMENT_LEVEL = 40;

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

function boundedText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").trim().slice(0, max);
}

export function toPublicShowcaseView(
  source: Record<string, unknown>,
): PublicShowcaseView {
  const achievements: PublicAchievement[] = [];
  const raw = source.achievements;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const label = boundedText(record.label, MAX_ACHIEVEMENT_LABEL);
      const level = boundedText(record.level, MAX_ACHIEVEMENT_LEVEL);
      if (!label || !level) continue;
      achievements.push({ label, level });
    }
  }

  return {
    chosenName: boundedText(source.chosenName, MAX_CHOSEN_NAME),
    clubName: boundedText(source.clubName, MAX_CLUB_NAME),
    achievements,
  };
}
