// Pure domain logic for plan confirmation and date selection.
// This is the single source of truth — screens and DB functions must not
// reimplement these rules.

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

/** The nested shape returned by Supabase selects like
 *  `plan_date_options(id, date, date_availability(user_id))` */
export interface NestedDateOption extends DateOption {
  date_availability?: { user_id: string }[] | null;
}

export interface RsvpLike {
  user_id?: string;
  response: string | null;
}

export interface PlanConfirmationData {
  plan_type: 'fixed' | 'flexible';
  status?: string | null;
  min_people: number;
  rsvps?: RsvpLike[] | null;
  dateOptions?: DateOption[] | null;
  availabilities?: Availability[] | null;
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

/**
 * Converts the nested Supabase select shape into flat date options +
 * availabilities so the counting functions can operate on either shape.
 */
export function flattenNestedOptions(
  nested: NestedDateOption[] | null | undefined
): { dateOptions: DateOption[]; availabilities: Availability[] } {
  const dateOptions: DateOption[] = [];
  const availabilities: Availability[] = [];

  (nested ?? []).forEach((opt) => {
    dateOptions.push({ id: opt.id, date: opt.date });
    (opt.date_availability ?? []).forEach((a) => {
      availabilities.push({ date_option_id: opt.id, user_id: a.user_id });
    });
  });

  return { dateOptions, availabilities };
}

export function getYesCount(rsvps: RsvpLike[] | null | undefined): number {
  return (rsvps ?? []).filter((r) => r.response === 'yes').length;
}

/**
 * The earliest date that meets the minimum. Used for display ("when is this
 * happening"), where the soonest viable date is the honest answer.
 */
export function earliestViableDate(
  countByDate: Record<string, DateCount>,
  minPeople: number
): string | null {
  const viable = Object.values(countByDate)
    .filter((v) => v.count >= minPeople)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return viable[0]?.date ?? null;
}

/**
 * The viable option with the most availability. Used for locking, where the
 * host wants the date the most people can make. Ties break toward the
 * earlier date so the result is deterministic.
 */
export function bestViableOption(
  countByDate: Record<string, DateCount>,
  minPeople: number
): { id: string; date: string; count: number } | null {
  const viable = Object.entries(countByDate)
    .filter(([_, v]) => v.count >= minPeople)
    .sort((a, b) =>
      b[1].count - a[1].count !== 0
        ? b[1].count - a[1].count
        : new Date(a[1].date).getTime() - new Date(b[1].date).getTime()
    );
  const top = viable[0];
  return top ? { id: top[0], date: top[1].date, count: top[1].count } : null;
}

/**
 * Whether a plan has enough people to happen. Locked plans are confirmed by
 * definition; cancelled plans never are. Fixed plans count yes-RSVPs;
 * flexible plans are confirmed when any single date option reaches the
 * minimum.
 */
export function isPlanConfirmed(data: PlanConfirmationData): boolean {
  if (data.status === 'cancelled') return false;
  if (data.status === 'locked') return true;

  if (data.plan_type === 'fixed') {
    return getYesCount(data.rsvps) >= data.min_people;
  }

  const countByDate = countAvailabilityByDate(
    data.dateOptions ?? [],
    data.availabilities ?? []
  );
  return Object.values(countByDate).some((v) => v.count >= data.min_people);
}

/**
 * Whether the user has said yes (fixed) or marked any availability
 * (flexible).
 */
export function isUserParticipating(
  data: Pick<PlanConfirmationData, 'plan_type' | 'rsvps' | 'availabilities'>,
  userId: string | null | undefined
): boolean {
  if (!userId) return false;

  if (data.plan_type === 'fixed') {
    return (data.rsvps ?? []).some(
      (r) => r.user_id === userId && r.response === 'yes'
    );
  }

  return (data.availabilities ?? []).some((a) => a.user_id === userId);
}

/**
 * Whether the plan is still waiting on this user: open, and they have
 * neither answered (fixed) nor declined / marked availability (flexible).
 */
export function needsUserResponse(
  data: Pick<
    PlanConfirmationData,
    'plan_type' | 'status' | 'rsvps' | 'availabilities'
  >,
  userId: string | null | undefined
): boolean {
  if (data.status !== 'open' || !userId) return false;

  const userRsvp = (data.rsvps ?? []).find((r) => r.user_id === userId);

  if (data.plan_type === 'fixed') {
    return !userRsvp || userRsvp.response === null;
  }

  if (userRsvp?.response === 'no') return false;
  return !(data.availabilities ?? []).some((a) => a.user_id === userId);
}

export interface PlanDates {
  event_date?: string | null;
  locked_date?: string | null;
}

/**
 * The last date a plan could still happen on: the locked date, the fixed
 * date, or the latest of an open vote's options. Null when undated.
 */
export function planLastDate(
  plan: PlanDates,
  optionDates: string[] = []
): string | null {
  if (plan.locked_date) return plan.locked_date;
  if (plan.event_date) return plan.event_date;
  if (optionDates.length === 0) return null;
  return optionDates.reduce((a, b) =>
    new Date(a).getTime() >= new Date(b).getTime() ? a : b
  );
}

/**
 * Local midnight after the day the timestamp falls on. Built from date
 * components — never from a naive string (Hermes parses those as UTC).
 */
export function endOfLocalDay(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}

/**
 * Endings rule (design 19c–19e): a plan is past once the end of its last
 * possible day has gone by, in the viewer's timezone. Undated plans never
 * expire. Whether a past plan "happened" or "didn't happen" is a separate
 * question answered by isPlanConfirmed.
 */
export function isPlanPast(
  plan: PlanDates,
  optionDates: string[] = [],
  now: Date = new Date()
): boolean {
  const last = planLastDate(plan, optionDates);
  if (!last) return false;
  return now.getTime() >= endOfLocalDay(last).getTime();
}
