export interface RenderConfig {
  width: number;
  height: number;
  templateId: string;
  birthDate: string;
  weekIndex: number;
}

export const WEEKS_PER_YEAR = 52;
export const START_AGE = 0;
export const END_AGE = 90;
export const TOTAL_WEEKS = (END_AGE - START_AGE) * WEEKS_PER_YEAR;

export function calculateWeekIndex(birthDateStr: string): number {
  const birthDate = new Date(birthDateStr);
  const now = new Date();
  const ageMs = now.getTime() - birthDate.getTime();
  if (ageMs < 0) return 0;
  
  const ageInYears = ageMs / (1000 * 60 * 60 * 24 * 365.2425);
  if (ageInYears < START_AGE) return 0;
  
  const relativeAge = ageInYears - START_AGE;
  const weekIndex = Math.floor(relativeAge * WEEKS_PER_YEAR);
  
  return Math.min(Math.max(weekIndex, 0), TOTAL_WEEKS - 1);
}
