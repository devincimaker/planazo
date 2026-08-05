import {
  bestViableOption,
  countAvailabilityByDate,
  getYesCount,
  isPlanConfirmed,
  isPlanFull,
  isPlanPast,
  planLastDate,
  waitlistPosition,
  type DateCount,
} from '@planazo/shared';
import { fmtDay } from './dates';
import { spellCount } from './words';

// "Two short on the night" (19c) spells small counts out, capitalised because
// it opens the sentence. The words themselves live in lib/words.ts.
const countWord = (n: number) => {
  const word = spellCount(n);
  return word.charAt(0).toUpperCase() + word.slice(1);
};

type DeriveInput = {
  plan: any;
  rsvps?: any[];
  dateOptions?: any[];
  availabilities?: any[];
  membership?: { role: string } | null;
  memberIds?: string[];
  userId?: string;
};

/**
 * Everything the plan detail screen shows that is computed rather than
 * fetched. Pure — the screen wraps it in a useMemo keyed on the inputs.
 */
export function derivePlanDetail({
  plan,
  rsvps,
  dateOptions,
  availabilities,
  membership,
  memberIds,
  userId,
}: DeriveInput) {
  if (!plan) return null;
  const isFlexible = plan.plan_type === 'flexible';
  const isOpen = plan.status === 'open';
  const isLocked = plan.status === 'locked';
  const isCancelled = plan.status === 'cancelled';
  const isOpenFlexible = isFlexible && isOpen;

  const yesCount = getYesCount(rsvps);
  const countByDate: Record<string, DateCount> = countAvailabilityByDate(
    (dateOptions ?? []).map((o) => ({ id: o.id, date: o.date })),
    (availabilities ?? []).map((a) => ({ date_option_id: a.date_option_id, user_id: a.user_id }))
  );

  // Leading option: most availability, ties to the earlier date
  const lead = Object.entries(countByDate).sort(
    (a, b) =>
      b[1].count - a[1].count ||
      new Date(a[1].date).getTime() - new Date(b[1].date).getTime()
  )[0];
  const leadCount = lead?.[1].count ?? 0;

  const going = isOpenFlexible ? leadCount : yesCount;
  const confirmed = isPlanConfirmed({
    status: plan.status,
    plan_type: plan.plan_type,
    min_people: plan.min_people,
    rsvps,
    dateOptions,
    availabilities,
  });
  const gap = plan.min_people - going;

  // Endings (19a–19c): past = the end of the plan's last possible day has
  // gone by. Expired ("didn't happen") = past without reaching the minimum.
  // A past plan that reached it simply happened — detail stays as-is (MVP).
  const optionDates = (dateOptions ?? []).map((o) => o.date);
  const isPast = isPlanPast(plan, optionDates);
  const isExpired = isPast && !isCancelled && !confirmed;
  const isEnded = isCancelled || isExpired;
  const lastDate = planLastDate(plan, optionDates);

  let headline: string;
  if (isCancelled) headline = 'Called off';
  else if (isExpired) headline = `${countWord(gap)} short on the night`;
  else if (confirmed) headline = "It's on";
  else if (isOpenFlexible && lead && leadCount > 0)
    headline = `${gap} more on ${fmtDay(lead[1].date)}`;
  else headline = `${gap} more and it's on`;

  // Room is counted off `going`, the very number rendered beside it — NOT
  // off the yes-RSVPs the cap is actually enforced on. On an open flexible
  // plan `going` is availability on the leading date, so mixing the two
  // populations reads as a contradiction: "4 in · room for 6 more" on a cap
  // of 6, because nobody has a yes yet.
  //
  // "room for 0 more" was the old wording once a capped plan filled up —
  // technically true, and a strange way to say the door is shut (PLA-20).
  const room = plan.max_people ? Math.max(plan.max_people - going, 0) : null;
  const capLine = isExpired
    ? 'The date passed before it reached its minimum'
    : plan.max_people
      ? confirmed
        ? room === 0
          ? `${going} in · that's everyone`
          : `${going} in · room for ${room} more`
        : `Happens with ${plan.min_people} · caps at ${plan.max_people}`
      : `Happens with ${plan.min_people}`;

  const myAvail = (availabilities ?? []).filter((a) => a.user_id === userId);
  const myPickIds: string[] = myAvail.map((a) => a.date_option_id);
  const userRsvp = (rsvps ?? []).find((r) => r.user_id === userId);

  const goingPeople: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  const pushPerson = (uid: string, name: string) => {
    if (uid === userId || seen.has(uid)) return;
    seen.add(uid);
    goingPeople.push({ id: uid, name });
  };
  if (isOpenFlexible) {
    (availabilities ?? []).forEach((a) => pushPerson(a.user_id, a.profile?.display_name ?? '?'));
  } else {
    (rsvps ?? [])
      .filter((r) => r.response === 'yes')
      .forEach((r) => pushPerson(r.user_id, r.profile?.display_name ?? '?'));
  }
  const youIn = isOpenFlexible ? myAvail.length > 0 : userRsvp?.response === 'yes';

  const outCount = (rsvps ?? []).filter((r) => r.response === 'no').length;

  // A confirmed no is a name, not just a number (PLA-29). Built exactly like
  // goingPeople so the two sections read the same way: you are pulled out
  // into your own chip, everyone else keeps the order the rows came in.
  // Its own `seen` set — a person cannot hold a yes and a no at once, but
  // sharing goingPeople's would silently swallow anyone who did.
  const notGoingPeople: { id: string; name: string }[] = [];
  const seenOut = new Set<string>();
  (rsvps ?? [])
    .filter((r) => r.response === 'no')
    .forEach((r) => {
      if (r.user_id === userId || seenOut.has(r.user_id)) return;
      seenOut.add(r.user_id);
      notGoingPeople.push({ id: r.user_id, name: r.profile?.display_name ?? '?' });
    });
  const youOut = userRsvp?.response === 'no';

  // Members who never engaged at all — the nudge target (20a) and the
  // "4 never answered" line on 19c.
  const answeredIds = new Set<string>();
  (rsvps ?? []).forEach((r) => {
    if (r.response) answeredIds.add(r.user_id);
  });
  (availabilities ?? []).forEach((a) => answeredIds.add(a.user_id));
  const unanswered = (memberIds ?? []).filter((uid) => !answeredIds.has(uid)).length;

  const isHost = plan.created_by === userId || membership?.role === 'admin';
  const viableLead = bestViableOption(countByDate, plan.min_people);
  const youCancelled = plan.cancelled_by === userId;

  // Every place taken (PLA-20). Only meaningful where a yes is what's being
  // asked for — on an open flexible plan you're voting on dates, and the
  // seats aren't handed out until the lock.
  const isFull = !isOpenFlexible && isPlanFull({ max_people: plan.max_people, rsvps });

  // Only you see your own place in the queue (PLA-37). Counted from the rows
  // already fetched, so it costs nothing.
  const waitPosition = waitlistPosition(rsvps, userId);

  // PLA-32. The album opens when the night does and never closes again.
  // Mirrors can_add_plan_photo() in 20260803000001: the start is the locked
  // date if a flexible plan has one, otherwise the fixed date. A flexible
  // plan nobody has locked has neither, and no album, because the night does
  // not exist yet.
  const albumStart = plan.locked_date ?? plan.event_date;
  // A snapshot on purpose. The album opening is a once-per-plan threshold
  // hours wide, not something anyone watches tick over, so reading the clock
  // here costs a stale render nobody can perceive and saves a timer.
  const albumOpen = !!albumStart && new Date(albumStart).getTime() <= Date.now();

  // Looking is for the group, adding is for the people who were there. The
  // database enforces this; here it only decides whether to draw the button,
  // and a yes is a yes rather than availability on a flexible plan.
  const canAddPhotos =
    albumOpen && !isCancelled && (isHost || userRsvp?.response === 'yes');

  return {
    albumOpen,
    canAddPhotos,
    waitPosition,
    isFlexible,
    isOpen,
    isLocked,
    isCancelled,
    isOpenFlexible,
    confirmed,
    headline,
    capLine,
    isFull,
    going,
    yesCount,
    countByDate,
    leadId: lead?.[0] ?? null,
    myPickIds,
    userRsvp,
    goingPeople,
    youIn,
    outCount,
    notGoingPeople,
    youOut,
    unanswered,
    isHost,
    viableLead,
    youCancelled,
    isPast,
    isExpired,
    isEnded,
    lastDate,
  };
}

export type PlanDerived = NonNullable<ReturnType<typeof derivePlanDetail>>;
