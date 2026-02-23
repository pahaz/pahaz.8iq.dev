import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateWeekIndex, TOTAL_WEEKS } from './types';

describe('calculateWeekIndex', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return 0 if birth date is in the future', () => {
    const futureDate = '2030-01-01';
    vi.setSystemTime(new Date('2026-01-01'));
    expect(calculateWeekIndex(futureDate)).toBe(0);
  });

  it('should calculate correct week index for someone born 10 years ago', () => {
    vi.setSystemTime(new Date('2026-01-01'));
    const birthDate = '2016-01-01'; // 10 years ago
    // 10 years * 52 weeks = 520 weeks. 
    // Due to 365.2425 days in calculation, it might be slightly different but close.
    const result = calculateWeekIndex(birthDate);
    expect(result).toBeGreaterThanOrEqual(520);
    expect(result).toBeLessThan(525);
  });

  it('should clamp result to TOTAL_WEEKS - 1', () => {
    vi.setSystemTime(new Date('2120-01-01'));
    const birthDate = '1900-01-01';
    expect(calculateWeekIndex(birthDate)).toBe(TOTAL_WEEKS - 1);
  });

  it('should return 0 for exactly now', () => {
    const now = new Date('2026-01-01');
    vi.setSystemTime(now);
    expect(calculateWeekIndex(now.toISOString())).toBe(0);
  });
});
