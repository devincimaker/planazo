import { buildMonthGrid, MonthGridCell } from '../monthGrid';

const flat = (weeks: MonthGridCell[][]) => weeks.flat();
const days = (weeks: MonthGridCell[][]) => flat(weeks).filter((c) => c.iso);
const pads = (weeks: MonthGridCell[][]) => flat(weeks).filter((c) => !c.iso);

describe('buildMonthGrid', () => {
  it('always emits whole weeks of 7 cells', () => {
    for (let m = 0; m < 12; m++) {
      for (const week of buildMonthGrid(2026, m)) {
        expect(week).toHaveLength(7);
      }
    }
  });

  it('a month starting Sunday with 28 days needs no pads at all', () => {
    // February 2026: the only shape with zero pad cells.
    const weeks = buildMonthGrid(2026, 1);
    expect(weeks).toHaveLength(4);
    expect(pads(weeks)).toHaveLength(0);
    expect(weeks[0]?.[0]?.iso).toBe('2026-02-01');
    expect(weeks[3]?.[6]?.iso).toBe('2026-02-28');
  });

  it('a 31-day month starting Saturday spills into 6 weeks', () => {
    // August 2026: the widest a month can get.
    const weeks = buildMonthGrid(2026, 7);
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.slice(0, 6).every((c) => !c.iso)).toBe(true);
    expect(weeks[0]?.[6]?.iso).toBe('2026-08-01');
    expect(days(weeks).at(-1)?.iso).toBe('2026-08-31');
    expect(weeks[5]?.filter((c) => !c.iso)).toHaveLength(5);
  });

  it('pads the tail out to a whole week', () => {
    // September 2026 starts Tuesday: 2 leading + 30 days + 3 trailing.
    const weeks = buildMonthGrid(2026, 8);
    expect(weeks).toHaveLength(5);
    expect(flat(weeks).slice(0, 2).every((c) => !c.iso)).toBe(true);
    expect(flat(weeks).slice(-3).every((c) => !c.iso)).toBe(true);
    expect(days(weeks)).toHaveLength(30);
  });

  it('gives a leap-year February its 29th day', () => {
    const weeks = buildMonthGrid(2024, 1);
    expect(days(weeks)).toHaveLength(29);
    expect(days(weeks).at(-1)?.iso).toBe('2024-02-29');
  });

  it('numbers day cells 1..N in order with unpadded labels', () => {
    const d = days(buildMonthGrid(2026, 0));
    expect(d).toHaveLength(31);
    expect(d.map((c) => c.label)).toEqual(
      Array.from({ length: 31 }, (_, i) => String(i + 1))
    );
    expect(d[0]?.iso).toBe('2026-01-01');
  });

  it('gives every cell a unique key, pads included', () => {
    const keys = flat(buildMonthGrid(2026, 7)).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
