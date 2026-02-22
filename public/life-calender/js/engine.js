import { START_AGE, WEEKS_PER_YEAR, TOTAL_WEEKS } from './config.js';

export function calculateWeekIndex(birthDateStr) {
    const birthDate = new Date(birthDateStr);
    const now = new Date();
    const ageMs = now - birthDate;
    if (ageMs < 0) return 0;
    
    const ageInYears = ageMs / (1000 * 60 * 60 * 24 * 365.2425);
    if (ageInYears < START_AGE) return 0;
    
    const relativeAge = ageInYears - START_AGE;
    const weekIndex = Math.floor(relativeAge * WEEKS_PER_YEAR);
    
    return Math.min(Math.max(weekIndex, 0), TOTAL_WEEKS - 1);
}

export function calculateProgressPercent(weekIndex) {
    const progress = (weekIndex + 1) / TOTAL_WEEKS;
    return (progress * 100).toFixed(1);
}
