/** One cell of a month grid: a real day carries its iso + label, a pad is blank. */
export interface MonthGridCell {
  key: string;
  iso?: string;
  label?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD from a year, 0-based month and day. Zero-padded so string compare orders correctly. */
export const isoDate = (year: number, monthIndex: number, day: number) =>
  `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;

/** Today as YYYY-MM-DD in local time. */
export const isoOfDate = (d: Date) => isoDate(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * The calendar grid for one month: whole weeks of 7 cells, Sunday-first,
 * padded with blank cells before the 1st and after the last day.
 */
export function buildMonthGrid(year: number, monthIndex: number): MonthGridCell[][] {
  const firstDow = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const cells: MonthGridCell[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ key: `pad-${i}` });
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = isoDate(year, monthIndex, d);
    cells.push({ key: iso, iso, label: String(d) });
  }
  while (cells.length % 7 !== 0) cells.push({ key: `pad-t${cells.length}` });

  const weeks: MonthGridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
