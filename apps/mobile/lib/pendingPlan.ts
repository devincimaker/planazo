/**
 * A plan id held across signing in (PLA-81).
 *
 * The sibling of `lib/pendingJoin`, for the other link Planazo hands out.
 * `(app)/_layout` has no session guard, so a plan link tapped with no session
 * mounts the plan screen, queries as nobody, and gets the empty answer RLS gives
 * a stranger — telling someone their own group's plan isn't here. Holding the id
 * and sending them to sign in makes the link do what it said it would.
 *
 * It goes to **login**, where an invite goes to signup: an invite is how most
 * people meet Planazo, while a plan link comes from a group you are already in,
 * so an account almost certainly exists.
 *
 * In memory rather than on disk, for the same reason as the pending join: it
 * only has to survive a few screens of one app run, and a plan id that outlived
 * a relaunch would just be a stale destination waiting to surprise someone.
 */
let pendingPlanId: string | null = null;

export function stashPendingPlan(planId: string): void {
  pendingPlanId = planId;
}

/** Reads and clears in one go, so a plan is never opened twice. */
export function takePendingPlan(): string | null {
  const planId = pendingPlanId;
  pendingPlanId = null;
  return planId;
}
