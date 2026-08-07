import { fmtDay, fmtTime } from '../dates';

/**
 * fmtDay is "the one shape a date takes on cards, rows and notices", so this is
 * the only place the shape itself is pinned. Screen tests build their
 * expectations by calling fmtDay, which keeps them immune to the calendar but
 * means a change to the locale or the options would reformat every date in the
 * app without turning a single one of them red.
 */
describe('fmtDay', () => {
  it('is "Sun 12 Jul" — short weekday, bare day, short month, no year', () => {
    expect(fmtDay(new Date(2026, 6, 12, 19, 0).toISOString())).toBe('Sun 12 Jul');
  });

  it('does not pad the day, so the 1st is "1" and not "01"', () => {
    expect(fmtDay(new Date(2026, 7, 1, 19, 0).toISOString())).toBe('Sat 1 Aug');
  });
});

describe('fmtTime', () => {
  it('is 24-hour and zero-padded', () => {
    expect(fmtTime(new Date(2026, 6, 12, 18, 30).toISOString())).toBe('18:30');
    expect(fmtTime(new Date(2026, 6, 12, 9, 5).toISOString())).toBe('09:05');
  });
});
