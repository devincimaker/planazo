/** "Sat 12 Jul" — the one shape a date takes on cards, rows and notices. */
export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** "18:30" */
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const pad2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD from a year, 0-based month and day. Zero-padded so string compare orders correctly. */
export const isoDate = (year: number, monthIndex: number, day: number) =>
  `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;

/** A local Date as YYYY-MM-DD. */
export const isoOfDate = (d: Date) => isoDate(d.getFullYear(), d.getMonth(), d.getDate());
