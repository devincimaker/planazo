import { describe, it, expect } from 'vitest';
import {
  countAvailabilityByDate,
  findViableDates,
  getUsersForDateOption,
  flattenNestedOptions,
  getYesCount,
  seatsLeft,
  isPlanFull,
  getWaitingCount,
  waitlistPosition,
  earliestViableDate,
  bestViableOption,
  isPlanConfirmed,
  isUserParticipating,
  needsUserResponse,
  planLastDate,
  endOfLocalDay,
  isPlanPast,
  DateOption,
  Availability,
} from './plan-logic';

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

describe('flattenNestedOptions', () => {
  it('flattens the nested Supabase select shape', () => {
    const result = flattenNestedOptions([
      {
        id: 'date-1',
        date: '2025-01-15',
        date_availability: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
      },
      { id: 'date-2', date: '2025-01-16', date_availability: [] },
    ]);

    expect(result.dateOptions).toEqual([
      { id: 'date-1', date: '2025-01-15' },
      { id: 'date-2', date: '2025-01-16' },
    ]);
    expect(result.availabilities).toEqual([
      { date_option_id: 'date-1', user_id: 'user-1' },
      { date_option_id: 'date-1', user_id: 'user-2' },
    ]);
  });

  it('tolerates null/undefined input and null availability arrays', () => {
    expect(flattenNestedOptions(null)).toEqual({
      dateOptions: [],
      availabilities: [],
    });
    expect(flattenNestedOptions(undefined)).toEqual({
      dateOptions: [],
      availabilities: [],
    });
    expect(
      flattenNestedOptions([
        { id: 'date-1', date: '2025-01-15', date_availability: null },
      ]).availabilities
    ).toEqual([]);
  });
});

describe('getYesCount', () => {
  it('counts only yes responses', () => {
    expect(
      getYesCount([
        { response: 'yes' },
        { response: 'no' },
        { response: 'yes' },
        { response: 'pending' },
        { response: null },
      ])
    ).toBe(2);
  });

  it('handles null/undefined rsvps', () => {
    expect(getYesCount(null)).toBe(0);
    expect(getYesCount(undefined)).toBe(0);
  });
});

describe('seatsLeft / isPlanFull', () => {
  const yes = (n: number) => Array.from({ length: n }, () => ({ response: 'yes' }));

  it('counts places left against the cap', () => {
    expect(seatsLeft({ max_people: 6, rsvps: yes(4) })).toBe(2);
    expect(isPlanFull({ max_people: 6, rsvps: yes(4) })).toBe(false);
  });

  it('is full at exactly the cap', () => {
    expect(seatsLeft({ max_people: 6, rsvps: yes(6) })).toBe(0);
    expect(isPlanFull({ max_people: 6, rsvps: yes(6) })).toBe(true);
  });

  it('never reports negative room for a plan that predates enforcement', () => {
    expect(seatsLeft({ max_people: 6, rsvps: yes(8) })).toBe(0);
    expect(isPlanFull({ max_people: 6, rsvps: yes(8) })).toBe(true);
  });

  it('treats a null cap as no limit, not as zero', () => {
    expect(seatsLeft({ max_people: null, rsvps: yes(99) })).toBeNull();
    expect(seatsLeft({ rsvps: yes(99) })).toBeNull();
    expect(isPlanFull({ max_people: null, rsvps: yes(99) })).toBe(false);
  });

  it('only counts a yes as taking a place', () => {
    const rsvps = [
      { response: 'yes' },
      { response: 'no' },
      { response: 'pending' },
      { response: null },
    ];
    expect(seatsLeft({ max_people: 2, rsvps })).toBe(1);
    expect(isPlanFull({ max_people: 2, rsvps })).toBe(false);
  });

  it('is empty-safe', () => {
    expect(seatsLeft({ max_people: 4, rsvps: null })).toBe(4);
    expect(isPlanFull({ max_people: 4, rsvps: undefined })).toBe(false);
  });
});

// PLA-37. The numbers are an ordering key with gaps in it, so position is
// counted rather than read: what is honest is how many people are ahead.
describe('getWaitingCount / waitlistPosition', () => {
  const queue = [
    { user_id: 'a', response: 'yes', waitlist_seq: null },
    { user_id: 'b', response: 'pending', waitlist_seq: 3 },
    { user_id: 'c', response: 'pending', waitlist_seq: 7 },
    { user_id: 'd', response: 'pending', waitlist_seq: 12 },
    { user_id: 'e', response: 'no', waitlist_seq: null },
  ];

  it('counts only the people waiting', () => {
    expect(getWaitingCount(queue)).toBe(3);
    expect(getWaitingCount(null)).toBe(0);
    expect(getWaitingCount(undefined)).toBe(0);
  });

  it('reads position off the order, not off the number', () => {
    expect(waitlistPosition(queue, 'b')).toBe(1);
    expect(waitlistPosition(queue, 'c')).toBe(2);
    expect(waitlistPosition(queue, 'd')).toBe(3);
  });

  it('survives the gaps a promotion and a withdrawal leave behind', () => {
    // b was promoted (number cleared), c left. d is now at the front.
    const after = [
      { user_id: 'a', response: 'yes', waitlist_seq: null },
      { user_id: 'b', response: 'yes', waitlist_seq: null },
      { user_id: 'd', response: 'pending', waitlist_seq: 12 },
    ];
    expect(waitlistPosition(after, 'd')).toBe(1);
  });

  it('has no position for someone who is in, out, or absent', () => {
    expect(waitlistPosition(queue, 'a')).toBeNull();
    expect(waitlistPosition(queue, 'e')).toBeNull();
    expect(waitlistPosition(queue, 'nobody')).toBeNull();
    expect(waitlistPosition(queue, null)).toBeNull();
    expect(waitlistPosition(null, 'b')).toBeNull();
  });
});

// A pending row is a third state the rest of the logic predates. These pin the
// behaviour it already has rather than changing it: waiting means you have
// answered, and it does not mean you are in.
describe('a pending row', () => {
  const waiting = [{ user_id: 'u1', response: 'pending', waitlist_seq: 1 }];

  it('stops the plan nagging you for an answer', () => {
    expect(
      needsUserResponse({ plan_type: 'fixed', status: 'open', rsvps: waiting }, 'u1')
    ).toBe(false);
  });

  it('does not make you a participant', () => {
    expect(
      isUserParticipating({ plan_type: 'fixed', rsvps: waiting }, 'u1')
    ).toBe(false);
  });
});

describe('earliestViableDate', () => {
  it('returns the earliest date meeting the minimum, not the most popular', () => {
    const countByDate = {
      'date-1': { count: 5, date: '2025-01-20' },
      'date-2': { count: 3, date: '2025-01-15' },
      'date-3': { count: 2, date: '2025-01-10' },
    };

    expect(earliestViableDate(countByDate, 3)).toBe('2025-01-15');
  });

  it('returns null when nothing is viable', () => {
    expect(
      earliestViableDate({ 'date-1': { count: 1, date: '2025-01-15' } }, 3)
    ).toBeNull();
    expect(earliestViableDate({}, 1)).toBeNull();
  });
});

describe('bestViableOption', () => {
  it('returns the most-available viable option', () => {
    const countByDate = {
      'date-1': { count: 3, date: '2025-01-15' },
      'date-2': { count: 5, date: '2025-01-16' },
    };

    expect(bestViableOption(countByDate, 3)).toEqual({
      id: 'date-2',
      date: '2025-01-16',
      count: 5,
    });
  });

  it('breaks count ties toward the earlier date', () => {
    const countByDate = {
      'date-late': { count: 4, date: '2025-01-20' },
      'date-early': { count: 4, date: '2025-01-12' },
    };

    expect(bestViableOption(countByDate, 2)?.id).toBe('date-early');
  });

  it('returns null when nothing is viable', () => {
    expect(
      bestViableOption({ 'date-1': { count: 1, date: '2025-01-15' } }, 3)
    ).toBeNull();
  });
});

describe('isPlanConfirmed', () => {
  it('confirms a fixed plan at exactly the minimum', () => {
    expect(
      isPlanConfirmed({
        plan_type: 'fixed',
        status: 'open',
        min_people: 2,
        rsvps: [{ response: 'yes' }, { response: 'yes' }, { response: 'no' }],
      })
    ).toBe(true);
  });

  it('does not confirm a fixed plan below the minimum', () => {
    expect(
      isPlanConfirmed({
        plan_type: 'fixed',
        status: 'open',
        min_people: 3,
        rsvps: [{ response: 'yes' }, { response: 'yes' }],
      })
    ).toBe(false);
  });

  it('confirms a flexible plan when any single option reaches the minimum', () => {
    expect(
      isPlanConfirmed({
        plan_type: 'flexible',
        status: 'open',
        min_people: 2,
        dateOptions: [
          { id: 'date-1', date: '2025-01-15' },
          { id: 'date-2', date: '2025-01-16' },
        ],
        availabilities: [
          { date_option_id: 'date-1', user_id: 'user-1' },
          { date_option_id: 'date-2', user_id: 'user-1' },
          { date_option_id: 'date-2', user_id: 'user-2' },
        ],
      })
    ).toBe(true);
  });

  it('does not confirm a flexible plan where votes are spread thin', () => {
    expect(
      isPlanConfirmed({
        plan_type: 'flexible',
        status: 'open',
        min_people: 2,
        dateOptions: [
          { id: 'date-1', date: '2025-01-15' },
          { id: 'date-2', date: '2025-01-16' },
        ],
        availabilities: [
          { date_option_id: 'date-1', user_id: 'user-1' },
          { date_option_id: 'date-2', user_id: 'user-2' },
        ],
      })
    ).toBe(false);
  });

  it('treats locked plans as confirmed regardless of counts', () => {
    expect(
      isPlanConfirmed({
        plan_type: 'fixed',
        status: 'locked',
        min_people: 10,
        rsvps: [],
      })
    ).toBe(true);
  });

  it('never confirms cancelled plans', () => {
    expect(
      isPlanConfirmed({
        plan_type: 'fixed',
        status: 'cancelled',
        min_people: 1,
        rsvps: [{ response: 'yes' }, { response: 'yes' }],
      })
    ).toBe(false);
  });

  it('handles missing rsvps/options', () => {
    expect(
      isPlanConfirmed({ plan_type: 'fixed', status: 'open', min_people: 2 })
    ).toBe(false);
    expect(
      isPlanConfirmed({ plan_type: 'flexible', status: 'open', min_people: 2 })
    ).toBe(false);
  });
});

describe('isUserParticipating', () => {
  it('is true for a fixed plan only when the user said yes', () => {
    const rsvps = [
      { user_id: 'user-1', response: 'yes' },
      { user_id: 'user-2', response: 'no' },
    ];
    expect(
      isUserParticipating({ plan_type: 'fixed', rsvps }, 'user-1')
    ).toBe(true);
    expect(
      isUserParticipating({ plan_type: 'fixed', rsvps }, 'user-2')
    ).toBe(false);
  });

  it('is true for a flexible plan when the user marked any availability', () => {
    const availabilities = [{ date_option_id: 'date-1', user_id: 'user-1' }];
    expect(
      isUserParticipating({ plan_type: 'flexible', availabilities }, 'user-1')
    ).toBe(true);
    expect(
      isUserParticipating({ plan_type: 'flexible', availabilities }, 'user-2')
    ).toBe(false);
  });

  it('is false without a user id', () => {
    expect(isUserParticipating({ plan_type: 'fixed', rsvps: [] }, null)).toBe(
      false
    );
  });
});

describe('needsUserResponse', () => {
  it('is false for non-open plans', () => {
    expect(
      needsUserResponse(
        { plan_type: 'fixed', status: 'locked', rsvps: [] },
        'user-1'
      )
    ).toBe(false);
  });

  it('fixed: true when unanswered or response is null', () => {
    expect(
      needsUserResponse(
        { plan_type: 'fixed', status: 'open', rsvps: [] },
        'user-1'
      )
    ).toBe(true);
    expect(
      needsUserResponse(
        {
          plan_type: 'fixed',
          status: 'open',
          rsvps: [{ user_id: 'user-1', response: null }],
        },
        'user-1'
      )
    ).toBe(true);
    expect(
      needsUserResponse(
        {
          plan_type: 'fixed',
          status: 'open',
          rsvps: [{ user_id: 'user-1', response: 'no' }],
        },
        'user-1'
      )
    ).toBe(false);
  });

  it('flexible: false when declined, false when availability marked, true otherwise', () => {
    const base = { plan_type: 'flexible' as const, status: 'open' };
    expect(
      needsUserResponse(
        { ...base, rsvps: [{ user_id: 'user-1', response: 'no' }] },
        'user-1'
      )
    ).toBe(false);
    expect(
      needsUserResponse(
        {
          ...base,
          availabilities: [{ date_option_id: 'date-1', user_id: 'user-1' }],
        },
        'user-1'
      )
    ).toBe(false);
    expect(needsUserResponse({ ...base }, 'user-1')).toBe(true);
  });
});

describe('endings — planLastDate / endOfLocalDay / isPlanPast', () => {
  it('planLastDate prefers locked, then fixed, then the latest option', () => {
    expect(
      planLastDate(
        { locked_date: '2026-08-13T20:00:00Z', event_date: null },
        ['2026-08-20T20:00:00Z']
      )
    ).toBe('2026-08-13T20:00:00Z');
    expect(planLastDate({ event_date: '2026-08-08T19:00:00Z' })).toBe('2026-08-08T19:00:00Z');
    expect(
      planLastDate({ event_date: null, locked_date: null }, [
        '2026-08-07T20:00:00Z',
        '2026-08-14T20:00:00Z',
        '2026-08-09T20:00:00Z',
      ])
    ).toBe('2026-08-14T20:00:00Z');
    expect(planLastDate({ event_date: null, locked_date: null }, [])).toBeNull();
  });

  it('endOfLocalDay is midnight after the local day of the stamp', () => {
    const eod = endOfLocalDay(new Date(2026, 7, 8, 19, 0).toISOString());
    expect(eod.getFullYear()).toBe(2026);
    expect(eod.getMonth()).toBe(7);
    expect(eod.getDate()).toBe(9);
    expect(eod.getHours()).toBe(0);
  });

  it('a plan stays live through its whole day and expires at local midnight', () => {
    const evening = new Date(2026, 7, 8, 19, 0).toISOString();
    const plan = { event_date: evening, locked_date: null };
    // Later the same night — still not past
    expect(isPlanPast(plan, [], new Date(2026, 7, 8, 23, 30))).toBe(false);
    // Next morning — past
    expect(isPlanPast(plan, [], new Date(2026, 7, 9, 0, 1))).toBe(true);
  });

  it('an open vote lives until the end of its latest option', () => {
    const plan = { event_date: null, locked_date: null };
    const opts = [
      new Date(2026, 7, 7, 20, 0).toISOString(),
      new Date(2026, 7, 14, 20, 0).toISOString(),
    ];
    expect(isPlanPast(plan, opts, new Date(2026, 7, 10, 12, 0))).toBe(false);
    expect(isPlanPast(plan, opts, new Date(2026, 7, 15, 0, 1))).toBe(true);
    // Undated plans never expire
    expect(isPlanPast(plan, [], new Date(2030, 0, 1))).toBe(false);
  });
});
