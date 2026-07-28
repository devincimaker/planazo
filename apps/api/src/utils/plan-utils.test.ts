import { describe, it, expect } from 'vitest';
import {
  countAvailabilityByDate,
  findViableDates,
  getUsersForDateOption,
  DateOption,
  Availability,
} from './plan-utils.js';

describe('countAvailabilityByDate', () => {
  it('returns zero counts when no availabilities exist', () => {
    const dateOptions: DateOption[] = [
      { id: 'date-1', date: '2025-01-15' },
      { id: 'date-2', date: '2025-01-16' },
    ];
    const availabilities: Availability[] = [];

    const result = countAvailabilityByDate(dateOptions, availabilities);

    expect(result).toEqual({
      'date-1': { count: 0, date: '2025-01-15' },
      'date-2': { count: 0, date: '2025-01-16' },
    });
  });

  it('counts availabilities per date option', () => {
    const dateOptions: DateOption[] = [
      { id: 'date-1', date: '2025-01-15' },
      { id: 'date-2', date: '2025-01-16' },
    ];
    const availabilities: Availability[] = [
      { date_option_id: 'date-1', user_id: 'user-1' },
      { date_option_id: 'date-1', user_id: 'user-2' },
      { date_option_id: 'date-2', user_id: 'user-1' },
    ];

    const result = countAvailabilityByDate(dateOptions, availabilities);

    expect(result['date-1'].count).toBe(2);
    expect(result['date-2'].count).toBe(1);
  });

  it('ignores availabilities for unknown date options', () => {
    const dateOptions: DateOption[] = [{ id: 'date-1', date: '2025-01-15' }];
    const availabilities: Availability[] = [
      { date_option_id: 'date-1', user_id: 'user-1' },
      { date_option_id: 'unknown-date', user_id: 'user-2' },
    ];

    const result = countAvailabilityByDate(dateOptions, availabilities);

    expect(result['date-1'].count).toBe(1);
    expect(result['unknown-date']).toBeUndefined();
  });

  it('handles empty date options', () => {
    const result = countAvailabilityByDate([], []);
    expect(result).toEqual({});
  });
});

describe('findViableDates', () => {
  it('returns empty array when no dates meet minimum', () => {
    const countByDate = {
      'date-1': { count: 2, date: '2025-01-15' },
      'date-2': { count: 1, date: '2025-01-16' },
    };

    const result = findViableDates(countByDate, 5);

    expect(result).toEqual([]);
  });

  it('returns dates that meet minimum threshold', () => {
    const countByDate = {
      'date-1': { count: 3, date: '2025-01-15' },
      'date-2': { count: 5, date: '2025-01-16' },
      'date-3': { count: 2, date: '2025-01-17' },
    };

    const result = findViableDates(countByDate, 3);

    expect(result).toHaveLength(2);
    expect(result.map(([id]) => id)).toContain('date-1');
    expect(result.map(([id]) => id)).toContain('date-2');
  });

  it('sorts by count descending (most popular first)', () => {
    const countByDate = {
      'date-1': { count: 3, date: '2025-01-15' },
      'date-2': { count: 7, date: '2025-01-16' },
      'date-3': { count: 5, date: '2025-01-17' },
    };

    const result = findViableDates(countByDate, 1);

    expect(result[0][0]).toBe('date-2');
    expect(result[1][0]).toBe('date-3');
    expect(result[2][0]).toBe('date-1');
  });

  it('includes dates exactly at minimum threshold', () => {
    const countByDate = {
      'date-1': { count: 3, date: '2025-01-15' },
    };

    const result = findViableDates(countByDate, 3);

    expect(result).toHaveLength(1);
    expect(result[0][1].count).toBe(3);
  });

  it('handles empty input', () => {
    const result = findViableDates({}, 1);
    expect(result).toEqual([]);
  });
});

describe('getUsersForDateOption', () => {
  it('returns user IDs for the specified date option', () => {
    const availabilities: Availability[] = [
      { date_option_id: 'date-1', user_id: 'user-1' },
      { date_option_id: 'date-1', user_id: 'user-2' },
      { date_option_id: 'date-2', user_id: 'user-3' },
    ];

    const result = getUsersForDateOption(availabilities, 'date-1');

    expect(result).toEqual(['user-1', 'user-2']);
  });

  it('returns empty array when no users match', () => {
    const availabilities: Availability[] = [
      { date_option_id: 'date-1', user_id: 'user-1' },
    ];

    const result = getUsersForDateOption(availabilities, 'date-2');

    expect(result).toEqual([]);
  });

  it('handles empty availabilities', () => {
    const result = getUsersForDateOption([], 'date-1');
    expect(result).toEqual([]);
  });
});
