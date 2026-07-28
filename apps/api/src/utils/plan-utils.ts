export interface DateOption {
  id: string;
  date: string;
}

export interface Availability {
  date_option_id: string;
  user_id: string;
}

export interface DateCount {
  count: number;
  date: string;
}

/**
 * Counts availability per date option
 */
export function countAvailabilityByDate(
  dateOptions: DateOption[],
  availabilities: Availability[]
): Record<string, DateCount> {
  const countByDate: Record<string, DateCount> = {};

  dateOptions.forEach((opt) => {
    countByDate[opt.id] = { count: 0, date: opt.date };
  });

  availabilities.forEach((a) => {
    if (countByDate[a.date_option_id]) {
      countByDate[a.date_option_id].count++;
    }
  });

  return countByDate;
}

/**
 * Finds dates that meet minimum participant requirements,
 * sorted by popularity (most available users first)
 */
export function findViableDates(
  countByDate: Record<string, DateCount>,
  minPeople: number
): Array<[string, DateCount]> {
  return Object.entries(countByDate)
    .filter(([_, val]) => val.count >= minPeople)
    .sort((a, b) => b[1].count - a[1].count);
}

/**
 * Gets user IDs available for a specific date option
 */
export function getUsersForDateOption(
  availabilities: Availability[],
  dateOptionId: string
): string[] {
  return availabilities
    .filter((a) => a.date_option_id === dateOptionId)
    .map((a) => a.user_id);
}
