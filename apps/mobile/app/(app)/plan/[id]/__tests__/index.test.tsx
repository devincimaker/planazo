import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert, Share, StyleSheet, type ViewStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlanDetailScreen from '../index';
import { useAuthStore } from '../../../../../stores/authStore';
import { takePendingPlan } from '../../../../../lib/pendingPlan';
import { supabase } from '../../../../../lib/supabase';
import { fmtDay } from '../../../../../lib/dates';
import { iso } from '../../../../../lib/testing/dates';
import { chooseFromSheet, mockActionSheet, sheetOptions } from '../../../../../lib/testing/actionSheet';

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
// Mutable so a test can swap the route param under a mounted screen — what a
// deep link does to this route (PLA-18).
let mockParamId = 'plan-1';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockParamId }),
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));


jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    FadeInDown: {},
    FadeOutUp: {},
    LinearTransition: {},
  };
});

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

function chain(result: unknown) {
  const c: any = {};
  ['select', 'eq', 'in', 'neq', 'order', 'upsert', 'delete', 'single', 'maybeSingle'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return c;
}

const basePlan = {
  id: 'plan-1',
  group_id: 'g1',
  title: 'Padel + pizza',
  description: 'Court booked at half past',
  location: 'Padel Indoor Gràcia',
  min_people: 3,
  max_people: 6,
  created_by: 'u-marta',
  creator: { display_name: 'Marta' },
  groups: { id: 'g1', name: 'Domingueros' },
};

let rsvpsChain: ReturnType<typeof chain>;
let availChain: ReturnType<typeof chain>;

function prime({
  plan,
  rsvps = [],
  options = [],
  avail = [],
  role = 'member',
  members = [],
  polls = [],
}: {
  plan: Record<string, unknown>;
  rsvps?: unknown[];
  options?: unknown[];
  avail?: unknown[];
  role?: string;
  /** user_ids in the group — drives the nudge count and "never answered" */
  members?: string[];
  /** The plan's polls (PLA-47), oldest first. */
  polls?: Record<string, unknown>[];
}) {
  rsvpsChain = chain({ error: null });
  availChain = chain({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'plans') return chain({ data: plan, error: null });
    if (table === 'rsvps') {
      const c = chain({ data: rsvps, error: null });
      c.upsert = rsvpsChain.upsert;
      c.delete = rsvpsChain.delete;
      return c;
    }
    if (table === 'plan_date_options') return chain({ data: options, error: null });
    if (table === 'plan_polls') return chain({ data: polls, error: null });
    if (table === 'date_availability') {
      const c = chain({ data: avail, error: null });
      c.upsert = availChain.upsert;
      c.delete = availChain.delete;
      return c;
    }
    if (table === 'group_members') {
      // Two callers share the table: membership (.single() → own role) and
      // the member-id list (no .single()).
      const c = chain({ data: members.map((uid) => ({ user_id: uid })), error: null });
      c.single = jest.fn(() => chain({ data: { role }, error: null }));
      return c;
    }
    return chain({ data: null, error: null });
  });
  mockRpc.mockResolvedValue({ data: {}, error: null });
}

async function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  // A fresh element each time: React bails out of re-rendering an identical
  // element reference, which would make the swap below a silent no-op.
  const tree = () => (
    <QueryClientProvider client={client}>
      <PlanDetailScreen />
    </QueryClientProvider>
  );
  const utils = await render(tree());
  // Re-render the *same* instance — how new params reach an already-mounted
  // screen. Remounting would hide the bug this covers.
  return { ...utils, rerenderSameInstance: () => utils.rerender(tree()) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockParamId = 'plan-1';
  // Module state, so drain whatever a signed-out test left behind.
  takePendingPlan();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'dismissedAction' } as never);
  mockActionSheet();
  // A session as well as a user: signed out, this screen now holds the plan and
  // leaves for login instead of rendering (PLA-81), which is its own test below.
  useAuthStore.setState({
    session: { user: { id: 'me' } } as any,
    user: { id: 'me' } as any,
    profile: { id: 'me' } as any,
  });
});

/** Open the ··· menu and return its option labels. Pick a row with chooseFromSheet. */
async function openMenu() {
  await fireEvent.press(screen.getByTestId('plan-menu'));
  return sheetOptions();
}

describe('PlanDetailScreen — fixed plans', () => {
  it('tells the gap below minimum and answers via upsert', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(7) },
      rsvps: [
        { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
        { user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } },
      ],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("1 more and it's on")).toBeTruthy());
    expect(screen.getByText('Happens with 3 · caps at 6')).toBeTruthy();

    await fireEvent.press(screen.getByText("I'm in"));
    await waitFor(() =>
      expect(rsvpsChain.upsert).toHaveBeenCalledWith(
        { plan_id: 'plan-1', user_id: 'me', response: 'yes' },
        { onConflict: 'plan_id,user_id' }
      )
    );
  });

  it('flips to "It\'s on" once the minimum is met and collapses my answer', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(7) },
      rsvps: [
        { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
        { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
        { user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } },
      ],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("It's on")).toBeTruthy());
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.getByText('3 in · room for 3 more')).toBeTruthy();
    expect(screen.getByText("You're in")).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
  });

  // PLA-20. The database is what actually refuses the seat; these cover the
  // screen saying so first, so the refusal is rare rather than routine.
  describe('a full plan', () => {
    const sixOthers = Array.from({ length: 6 }, (_, i) => ({
      user_id: `u-${i}`,
      response: 'yes',
      profile: { display_name: `Person ${i}` },
    }));

    it('offers the waiting list instead of "I\'m in" when every place is taken', async () => {
      prime({
        plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(7) },
        rsvps: sixOthers,
      });
      await renderDetail();

      // PLA-37: this was a dead "Full" button, which was honest and useless.
      await waitFor(() => expect(screen.getByText('Take the next spot')).toBeTruthy());
      expect(screen.queryByText("I'm in")).toBeNull();
      expect(screen.queryByText('Full')).toBeNull();
      // Saying no is still worth doing — it takes you off what it's waiting on.
      expect(screen.getByText("Can't make it")).toBeTruthy();
    });

    it('takes a place in the queue rather than a seat', async () => {
      prime({
        plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(7) },
        rsvps: sixOthers,
      });
      await renderDetail();

      await waitFor(() => expect(screen.getByText('Take the next spot')).toBeTruthy());
      await fireEvent.press(screen.getByText('Take the next spot'));

      await waitFor(() =>
        expect(rsvpsChain.upsert).toHaveBeenCalledWith(
          { plan_id: 'plan-1', user_id: 'me', response: 'pending' },
          { onConflict: 'plan_id,user_id' }
        )
      );
    });

    it('shows where you stand once you are on the list', async () => {
      prime({
        plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(7) },
        rsvps: [
          ...sixOthers,
          { user_id: 'w-1', response: 'pending', waitlist_seq: 1, profile: { display_name: 'A' } },
          { user_id: 'me', response: 'pending', waitlist_seq: 2, profile: { display_name: 'Me' } },
        ],
      });
      await renderDetail();

      await waitFor(() => expect(screen.getByText("You're 2nd in line")).toBeTruthy());
      // Not the join button any more, and not "You're in" either.
      expect(screen.queryByText('Take the next spot')).toBeNull();
      expect(screen.queryByText("You're in")).toBeNull();
      expect(screen.getByText("If a spot opens, it's yours. We'll tell you.")).toBeTruthy();
    });

    it('lets you leave the queue the same way you leave a plan', async () => {
      prime({
        plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(7) },
        rsvps: [
          ...sixOthers,
          { user_id: 'me', response: 'pending', waitlist_seq: 1, profile: { display_name: 'Me' } },
        ],
      });
      await renderDetail();

      await waitFor(() => expect(screen.getByText("You're next in line")).toBeTruthy());
      await fireEvent.press(screen.getByText('Change'));
      await waitFor(() => expect(rsvpsChain.delete).toHaveBeenCalled());
    });

    it('says "that\'s everyone" rather than "room for 0 more"', async () => {
      prime({
        plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(7) },
        rsvps: sixOthers,
      });
      await renderDetail();

      await waitFor(() => expect(screen.getByText("6 in · that's everyone")).toBeTruthy());
      expect(screen.queryByText('6 in · room for 0 more')).toBeNull();
    });

    it('still lets someone already in withdraw', async () => {
      prime({
        plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(7) },
        rsvps: [
          { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
          ...sixOthers.slice(0, 5),
        ],
      });
      await renderDetail();

      await waitFor(() => expect(screen.getByText("You're in")).toBeTruthy());
      expect(screen.queryByText('Full')).toBeNull();
      await fireEvent.press(screen.getByText('Change'));
      await waitFor(() => expect(rsvpsChain.delete).toHaveBeenCalled());
    });

    it('leaves an uncapped plan alone no matter how many say yes', async () => {
      prime({
        plan: {
          ...basePlan,
          max_people: null,
          plan_type: 'fixed',
          status: 'open',
          event_date: iso(7),
        },
        rsvps: sixOthers,
      });
      await renderDetail();

      await waitFor(() => expect(screen.getByText("I'm in")).toBeTruthy());
      expect(screen.queryByText('Full')).toBeNull();
    });
  });
});

describe('PlanDetailScreen — flexible plans', () => {
  // The date picker is gated on !isPast, and isPast reads the *last* option
  // date — so both of these have to stay ahead of today for vote-d1/d2 to exist.
  const options = [
    { id: 'd1', date: iso(7, 12) },
    { id: 'd2', date: iso(8, 12) },
  ];

  it('tracks the leading date in the headline and sends picked dates', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'flexible', status: 'open', event_date: null },
      options,
      avail: [
        { id: 'a1', date_option_id: 'd1', user_id: 'u-aina', profile: { display_name: 'Aina' } },
        { id: 'a2', date_option_id: 'd1', user_id: 'u-jordi', profile: { display_name: 'Jordi' } },
      ],
    });
    await renderDetail();

    // Same formatter the headline is built with (planDerived.ts:93), so this
    // stays an assertion about *which* date leads rather than about the
    // calendar the day it was written.
    await waitFor(() =>
      expect(screen.getByText(`1 more on ${fmtDay(options[0]!.date)}`)).toBeTruthy()
    );
    expect(screen.getByText('Leading')).toBeTruthy();
    expect(screen.getByText('Tap the dates you can do')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('vote-d2'));
    await fireEvent.press(screen.getByText('Send 1 date'));

    await waitFor(() =>
      expect(availChain.upsert).toHaveBeenCalledWith(
        [{ plan_id: 'plan-1', user_id: 'me', date_option_id: 'd2', available: true }],
        { onConflict: 'plan_id,user_id,date_option_id' }
      )
    );
  });

  // PLA-22 regression: the way out of the picker was pinned to a 130pt box and
  // rendered "None of t…". Nothing in the footer may carry a fixed width, and
  // the button it names has to still decline.
  it('offers the whole "None of them" label, on a button with no fixed width', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'flexible', status: 'open', event_date: null },
      options,
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('None of them')).toBeTruthy());
    const style = StyleSheet.flatten(
      screen.getByTestId('decline-all').props.style
    ) as ViewStyle;
    expect(style.width).toBeUndefined();
    expect(style.flexBasis).toBeUndefined();

    await fireEvent.press(screen.getByTestId('decline-all'));
    await waitFor(() =>
      expect(rsvpsChain.upsert).toHaveBeenCalledWith(
        { plan_id: 'plan-1', user_id: 'me', response: 'no' },
        { onConflict: 'plan_id,user_id' }
      )
    );
  });

  // PLA-20 regression: `going` on an open flexible plan is availability on the
  // leading date, but the cap is enforced on yes-RSVPs. Counting room off the
  // RSVPs while showing `going` beside it rendered "4 in · room for 6 more" on
  // a cap of 6 — two populations, one sentence.
  it('counts room off the same population it reports as "in"', async () => {
    prime({
      plan: {
        ...basePlan,
        max_people: 6,
        plan_type: 'flexible',
        status: 'open',
        event_date: null,
      },
      options,
      avail: [
        { id: 'a1', date_option_id: 'd1', user_id: 'u-aina', profile: { display_name: 'Aina' } },
        { id: 'a2', date_option_id: 'd1', user_id: 'u-jordi', profile: { display_name: 'Jordi' } },
        { id: 'a3', date_option_id: 'd1', user_id: 'u-marta', profile: { display_name: 'Marta' } },
        { id: 'a4', date_option_id: 'd1', user_id: 'u-rocio', profile: { display_name: 'Rocío' } },
      ],
      // Deliberately no RSVP rows — a running vote hands out no seats.
      rsvps: [],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('4 in · room for 2 more')).toBeTruthy());
    expect(screen.queryByText('4 in · room for 6 more')).toBeNull();
  });

  it('lets the host lock in the viable leading date via the RPC', async () => {
    prime({
      plan: {
        ...basePlan,
        plan_type: 'flexible',
        status: 'open',
        event_date: null,
        created_by: 'me',
      },
      options,
      avail: [
        { id: 'a1', date_option_id: 'd1', user_id: 'u-aina', profile: { display_name: 'Aina' } },
        { id: 'a2', date_option_id: 'd1', user_id: 'u-jordi', profile: { display_name: 'Jordi' } },
        { id: 'a3', date_option_id: 'd1', user_id: 'u-pau', profile: { display_name: 'Pau' } },
      ],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByTestId('lock-in')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('lock-in'));

    // Confirm dialog → press "Lock in"
    const alertCall = (Alert.alert as jest.Mock).mock.calls.at(-1);
    const lockButton = alertCall[2].find((b: any) => b.text === 'Lock in');
    lockButton.onPress();

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('lock_plan', {
        p_plan_id: 'plan-1',
        p_date_option_id: 'd1',
      })
    );
  });

  // PLA-17 regression: on a declined flexible plan the rows kept toggling
  // while the footer stayed on "You can't make it" — picks that could never
  // be sent, silently dropped on leaving. Tapping a date now reopens the
  // picker, and Send both records the picks and clears the "no".
  it('tapping a date while declined reopens the picker and Send undoes the decline', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'flexible', status: 'open', event_date: null },
      options,
      rsvps: [{ user_id: 'me', response: 'no', profile: { display_name: 'Me' } }],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("You can't make it")).toBeTruthy());
    expect(screen.queryByText('Send 1 date')).toBeNull();

    await fireEvent.press(screen.getByTestId('vote-d1'));

    // The footer follows the rows — the dead end is gone
    expect(screen.getByText('Send 1 date')).toBeTruthy();
    expect(screen.queryByText("You can't make it")).toBeNull();

    await fireEvent.press(screen.getByText('Send 1 date'));
    await waitFor(() =>
      expect(availChain.upsert).toHaveBeenCalledWith(
        [{ plan_id: 'plan-1', user_id: 'me', date_option_id: 'd1', available: true }],
        { onConflict: 'plan_id,user_id,date_option_id' }
      )
    );
    // Sending dates supersedes the standing "no" — scoped so the server
    // decides, and only ever clears a decline
    await waitFor(() => expect(rsvpsChain.delete).toHaveBeenCalled());
    expect(rsvpsChain.eq).toHaveBeenCalledWith('response', 'no');
    // The whole mutation succeeded — no error alert
    await waitFor(() => expect(Alert.alert).not.toHaveBeenCalled());
  });

  // "Change" on a plan you've already voted on reopens the picker seeded with
  // your own picks — the only other way into editing, and previously uncovered.
  it('reopens the picker on "Change" with the dates you already sent', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'flexible', status: 'open', event_date: null },
      options,
      avail: [{ id: 'a1', date_option_id: 'd1', user_id: 'me', profile: { display_name: 'Me' } }],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('You sent 1 date')).toBeTruthy());
    await fireEvent.press(screen.getByText('Change'));

    // The picker is live and still holds d1 — not an empty or dead footer
    expect(screen.getByText('Update your dates')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('vote-d2'));
    await fireEvent.press(screen.getByText('Update your dates'));

    await waitFor(() =>
      expect(availChain.upsert).toHaveBeenCalledWith(
        [
          { plan_id: 'plan-1', user_id: 'me', date_option_id: 'd1', available: true },
          { plan_id: 'plan-1', user_id: 'me', date_option_id: 'd2', available: true },
        ],
        { onConflict: 'plan_id,user_id,date_option_id' }
      )
    );
  });

  // PLA-18 regression: a deep link — a push tap, a shared planazo://plan/<id> —
  // resolves to this same route, so expo-router swaps `id` under the mounted
  // screen instead of remounting it. Plan A's picks used to survive that swap:
  // plan B rendered with no rows ticked but an enabled Send, and pressing it
  // would have written A's date_option_ids against B's plan_id.
  it("drops the previous plan's picks when a deep link swaps the id", async () => {
    prime({
      plan: { ...basePlan, plan_type: 'flexible', status: 'open', event_date: null },
      options,
    });
    const { rerenderSameInstance } = await renderDetail();

    await waitFor(() => expect(screen.getByTestId('vote-d1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('vote-d1'));
    expect(screen.getByText('Send 1 date')).toBeTruthy();

    // Plan B arrives by deep link: same screen instance, new id, its own dates
    prime({
      plan: {
        ...basePlan,
        id: 'plan-2',
        title: 'Vermut al Poblenou',
        plan_type: 'flexible',
        status: 'open',
        event_date: null,
      },
      options: [
        { id: 'd3', date: iso(14, 12) },
        { id: 'd4', date: iso(15, 12) },
      ],
    });
    mockParamId = 'plan-2';
    await rerenderSameInstance();

    await waitFor(() => expect(screen.getByTestId('vote-d3')).toBeTruthy());
    // Nothing inherited: no phantom Send over zero ticked rows, and the prompt
    // is back to the first-vote one
    expect(screen.queryByText('Send 1 date')).toBeNull();
    expect(screen.getByText('Tap the dates you can do')).toBeTruthy();

    // ...and picking on B writes B's option under B's plan
    await fireEvent.press(screen.getByTestId('vote-d3'));
    await fireEvent.press(screen.getByText('Send 1 date'));
    await waitFor(() =>
      expect(availChain.upsert).toHaveBeenCalledWith(
        [{ plan_id: 'plan-2', user_id: 'me', date_option_id: 'd3', available: true }],
        { onConflict: 'plan_id,user_id,date_option_id' }
      )
    );
  });

  // A reopened plan leaves seeded "yes" rows standing as held seats
  // (see 20260731000001): a seat is only ever given up by withdrawing.
  // Updating your date votes must not silently surrender it.
  it('sending dates never touches a held "yes" — only a decline is superseded', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'flexible', status: 'open', event_date: null },
      options,
      rsvps: [{ user_id: 'me', response: 'yes', profile: { display_name: 'Me' } }],
      avail: [{ id: 'a1', date_option_id: 'd1', user_id: 'me', profile: { display_name: 'Me' } }],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('You sent 1 date')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('vote-d2'));
    await fireEvent.press(screen.getByText('Update your dates'));

    await waitFor(() =>
      expect(availChain.upsert).toHaveBeenCalledWith(
        [
          { plan_id: 'plan-1', user_id: 'me', date_option_id: 'd1', available: true },
          { plan_id: 'plan-1', user_id: 'me', date_option_id: 'd2', available: true },
        ],
        { onConflict: 'plan_id,user_id,date_option_id' }
      )
    );
    // The RSVP delete is scoped to response = 'no' — the "yes" seat survives
    expect(rsvpsChain.eq).toHaveBeenCalledWith('response', 'no');
    await waitFor(() => expect(Alert.alert).not.toHaveBeenCalled());
  });

  it('locked plans ask for a plain yes/no and offer the host a reopen', async () => {
    prime({
      plan: {
        ...basePlan,
        plan_type: 'flexible',
        status: 'locked',
        locked_date: iso(7, 20),
        event_date: null,
        created_by: 'me',
      },
      options,
      avail: [],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("It's on")).toBeTruthy());
    expect(screen.getByText("I'm in")).toBeTruthy();
    expect(screen.queryByText('Which days work')).toBeNull();

    await fireEvent.press(screen.getByTestId('reopen'));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('reopen_plan', { p_plan_id: 'plan-1' })
    );
  });

});

describe('PlanDetailScreen — the 20a menu', () => {
  it("host menu carries Edit and Call it off, and routes to each; nudge counts the silent", async () => {
    prime({
      plan: {
        ...basePlan,
        plan_type: 'fixed',
        status: 'open',
        event_date: iso(8),
        created_by: 'me',
      },
      rsvps: [{ user_id: 'me', response: 'yes', profile: { display_name: 'Me' } }],
      members: ['me', 'u-marta', 'u-jordi', 'u-aina'],
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('plan-menu')).toBeTruthy());

    expect(await openMenu()).toEqual([
      'Copy link to this plan',
      "Nudge the 3 who haven't answered",
      'Edit the details',
      'Call it off',
      'Cancel',
    ]);

    await chooseFromSheet(2);
    expect(mockPush).toHaveBeenCalledWith('/plan/plan-1/edit');

    await chooseFromSheet(3);
    expect(mockPush).toHaveBeenCalledWith('/plan/plan-1/cancel');
  });

  it('PLA-47: the host sees the add-a-poll invitation in the plan body, guests do not', async () => {
    prime({
      plan: {
        ...basePlan,
        plan_type: 'fixed',
        status: 'open',
        event_date: iso(8),
        created_by: 'me',
      },
      rsvps: [{ user_id: 'me', response: 'yes', profile: { display_name: 'Me' } }],
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('poll-add')).toBeTruthy());
    expect(screen.getByText('+ Add a poll')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('poll-add'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/plan\/plan-1\/poll/));

    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(8) },
      rsvps: [{ user_id: 'me', response: 'yes', profile: { display_name: 'Me' } }],
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('plan-menu')).toBeTruthy());
    expect(screen.queryByTestId('poll-add')).toBeNull();
  });

  it('PLA-47: a group admin who is not in manages polls but holds no pick', async () => {
    prime({
      // Someone else's plan; I am a Weekend Crew admin who never answered.
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(8) },
      rsvps: [{ user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } }],
      role: 'admin',
      polls: [
        {
          id: 'q1',
          question: 'Which bar first?',
          created_at: '2026-08-04T10:00:00Z',
          plan_poll_options: [{ id: 'o1', label: 'Bar Colombo', position: 0 }],
          plan_poll_votes: [
            { option_id: 'o1', user_id: 'u-marta', profile: { display_name: 'Marta' } },
          ],
        },
      ],
    });
    await renderDetail();

    // Management yes: the dashed add card is there.
    await waitFor(() => expect(screen.getByTestId('poll-add')).toBeTruthy());
    // A pick no: the quiet caption shows and the row swallows the tap.
    expect(screen.getByText("Say you're in and you get a pick.")).toBeTruthy();
  });

  // PLA-55. Host powers and authorship are different questions, and the same
  // sentence used to answer them differently depending on whether the plan had
  // ended. An admin can edit and cancel a plan they had nothing to do with;
  // telling them they hosted it is untrue.
  it('tells an admin who posted it, rather than crediting them with it', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(8) },
      role: 'admin',
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('Hosted by Marta')).toBeTruthy());
    expect(screen.queryByText('Hosted by you')).toBeNull();
  });

  it('back falls back to the group screen after a deep link', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(8) },
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('back')).toBeTruthy());

    mockCanGoBack = false;
    await fireEvent.press(screen.getByTestId('back'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/group/g1');
  });

  it('guests get the same menu minus Call it off', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(8) },
      members: ['me', 'u-marta'],
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('plan-menu')).toBeTruthy());

    const options = await openMenu();
    expect(options).not.toContain('Call it off');
    expect(options).not.toContain('Edit the details');
    expect(options).toContain('Copy link to this plan');
  });

  /**
   * PLA-81: the defect. Both ways of handing a plan to someone used to spell a
   * `planazo://` link, which no messenger turns into something tappable, so it
   * arrived as grey text and anyone without the app got nothing at all.
   */
  it('copies an https link, and shares one', async () => {
    prime({
      plan: {
        ...basePlan,
        plan_type: 'fixed',
        status: 'open',
        event_date: iso(8),
        created_by: 'me',
      },
      members: ['me', 'u-marta'],
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('plan-menu')).toBeTruthy());

    await openMenu();
    await chooseFromSheet(0);
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalled());
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://planazo.me/plan/plan-1');

    await openMenu();
    await chooseFromSheet(1);
    const shared = (Share.share as jest.Mock).mock.calls[0][0].message;
    expect(shared).toContain('https://planazo.me/plan/plan-1');
    expect(shared).not.toContain('planazo://');
  });

  // Both host rows share one guard, and on these two plans both are
  // meaningless: there is nothing left to call off, and the stone card is a
  // record of what was — editing the title would rewrite it after the fact.
  it('a called-off plan offers its host neither host row', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'cancelled', event_date: iso(8), created_by: 'me' },
      members: ['me', 'u-marta'],
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('plan-menu')).toBeTruthy());

    const options = await openMenu();
    expect(options).not.toContain('Edit the details');
    expect(options).not.toContain('Call it off');
  });

  it('a plan whose date has passed offers its host neither host row', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(-3), created_by: 'me' },
      members: ['me', 'u-marta'],
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('plan-menu')).toBeTruthy());

    const options = await openMenu();
    expect(options).not.toContain('Edit the details');
    expect(options).not.toContain('Call it off');
  });
});

describe('PlanDetailScreen — endings', () => {
  const cancelledPlan = {
    ...basePlan,
    plan_type: 'fixed',
    status: 'cancelled',
    event_date: iso(10),
    cancelled_at: iso(-1, 18),
    cancelled_by: 'u-marta',
    cancel_reason: 'Pitch flooded, they’ve shut the whole site till Monday.',
    canceller: { display_name: 'Marta' },
  };

  it('19a: called off shows the stone card and removes the footer entirely', async () => {
    prime({
      plan: cancelledPlan,
      rsvps: [
        { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
        { user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } },
      ],
      members: ['me', 'u-marta', 'u-jordi'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('Called off')).toBeTruthy());
    expect(screen.getByText('Marta called this off')).toBeTruthy();
    expect(
      screen.getByText('“Pitch flooded, they’ve shut the whole site till Monday.”')
    ).toBeTruthy();
    expect(screen.getByText('Was going')).toBeTruthy();
    // Footer gone — no answer buttons, no reopen for a guest
    expect(screen.queryByText("I'm in")).toBeNull();
    expect(screen.queryByTestId('restore')).toBeNull();
    // The count is a question and there's no question left
    expect(screen.queryByTestId('slot-filled')).toBeNull();
  });

  it('19b: the host sees Reopen while the date is ahead, wired to restore_plan', async () => {
    prime({
      plan: { ...cancelledPlan, created_by: 'me', cancelled_by: 'me', canceller: null },
      rsvps: [{ user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } }],
      members: ['me', 'u-jordi'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('You called this off')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('restore'));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('restore_plan', { p_plan_id: 'plan-1' })
    );
  });

  it('19b: reopen disappears once the date has passed', async () => {
    prime({
      plan: { ...cancelledPlan, created_by: 'me', cancelled_by: 'me', event_date: iso(-3) },
      members: ['me'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('You called this off')).toBeTruthy());
    expect(screen.queryByTestId('restore')).toBeNull();
  });

  it("19c: didn't happen — frozen count, the explanation line, and try again", async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(-2) },
      rsvps: [
        { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
        { user_id: 'u-pau', response: 'no', profile: { display_name: 'Pau' } },
      ],
      members: ['me', 'u-marta', 'u-jordi', 'u-pau'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("Didn't happen")).toBeTruthy());
    expect(screen.getByText('Two short on the night')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.getByText('The date passed before it reached its minimum')).toBeTruthy();
    expect(screen.getByText('Were in')).toBeTruthy();
    expect(screen.getByText("2 never answered · 1 couldn't make it")).toBeTruthy();
    expect(screen.queryByText("I'm in")).toBeNull();

    await fireEvent.press(screen.getByTestId('try-again'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/plan/create',
      params: {
        groupId: 'g1',
        title: 'Padel + pizza',
        min: '3',
        cap: '6',
        location: 'Padel Indoor Gràcia',
        details: '1',
      },
    });
  });

  it('a past plan that reached its minimum simply happened — detail unchanged', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(-2) },
      rsvps: [
        { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
        { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
        { user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } },
      ],
      members: ['me', 'u-marta', 'u-jordi'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("It's on")).toBeTruthy());
    expect(screen.queryByText("Didn't happen")).toBeNull();
  });
});

// PLA-29: a confirmed no was counted and never named, so a host could see that
// three people were out without knowing which three — exactly the thing you
// need to decide whether to chase someone or call it off.
describe('PlanDetailScreen — who said no', () => {
  it('names the people who declined instead of counting them', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(4) },
      rsvps: [
        { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
        { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
        { user_id: 'u-pau', response: 'no', profile: { display_name: 'Pau' } },
        { user_id: 'u-sam', response: 'no', profile: { display_name: 'Sam' } },
      ],
      members: ['me', 'u-marta', 'u-pau', 'u-sam'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('Going')).toBeTruthy());
    expect(screen.getByTestId('declined-section')).toBeTruthy();
    expect(screen.getByText('Pau')).toBeTruthy();
    expect(screen.getByText('Sam')).toBeTruthy();
    // The bare count it replaces is gone, not merely supplemented
    expect(screen.queryByText("2 can't make it")).toBeNull();
  });

  it('leaves the section out entirely when nobody has declined', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(4) },
      rsvps: [{ user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } }],
      members: ['me', 'u-marta'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('Going')).toBeTruthy());
    // Queried by testID, not by text: the footer's own decline button carries
    // the same words on a plan you have not answered.
    expect(screen.queryByTestId('declined-section')).toBeNull();
  });

  // Your own no is yours the same way your own yes is: the going list already
  // splits "You" out of the names, and this list matches it.
  it('puts you in it when you are the one who declined', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(4) },
      rsvps: [
        { user_id: 'me', response: 'no', profile: { display_name: 'Me' } },
        { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
      ],
      members: ['me', 'u-marta'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByTestId('declined-section')).toBeTruthy());
    expect(screen.getByText('You')).toBeTruthy();
    // Named once, in the declined list — never mirrored into the going one
    expect(screen.getAllByText('You')).toHaveLength(1);
  });

  // A vote of "None of them" writes the same `no` row as a fixed plan's
  // "Can't make it", so it has to surface in the same place.
  it('names a flexible-plan decline beside the people still in the mix', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'flexible', status: 'open' },
      options: [{ id: 'o1', date: iso(3) }],
      avail: [{ id: 'a1', user_id: 'u-marta', date_option_id: 'o1', profile: { display_name: 'Marta' } }],
      rsvps: [{ user_id: 'u-pau', response: 'no', profile: { display_name: 'Pau' } }],
      members: ['me', 'u-marta', 'u-pau'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('In the mix')).toBeTruthy());
    expect(screen.getByText('Marta')).toBeTruthy();
    expect(screen.getByTestId('declined-section')).toBeTruthy();
    expect(screen.getByText('Pau')).toBeTruthy();
  });

  // An ended plan keeps its single summary line: naming the declines there
  // would be a second sunken chip row under an already sunken going row.
  it('stays off the ended screens, which keep their summary line', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(-2) },
      rsvps: [
        { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
        { user_id: 'u-pau', response: 'no', profile: { display_name: 'Pau' } },
      ],
      members: ['me', 'u-marta', 'u-jordi', 'u-pau'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('Were in')).toBeTruthy());
    expect(screen.getByText("2 never answered · 1 couldn't make it")).toBeTruthy();
    expect(screen.queryByTestId('declined-section')).toBeNull();
    expect(screen.queryByText('Pau')).toBeNull();
  });
});

// PLA-19: an unknown or RLS-hidden plan used to spin forever. `.single()` throws
// PGRST116, the query settles with no data, and the guard had no error branch.
describe('PlanDetailScreen — a plan you cannot see', () => {
  const notFound = {
    code: 'PGRST116',
    message: 'JSON object requested, multiple (or no) rows returned',
  };

  function primeMissing(planResult: unknown) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'plans') return chain(planResult);
      return chain({ data: [], error: null });
    });
    mockRpc.mockResolvedValue({ data: {}, error: null });
  }

  it('says so instead of spinning forever', async () => {
    primeMissing({ data: null, error: notFound });
    await renderDetail();

    await waitFor(() => expect(screen.getByTestId('plan-error')).toBeTruthy());
    expect(screen.getByText("This plan isn't here")).toBeTruthy();
    expect(screen.queryByTestId('plan-error-retry')).toBeNull();
  });

  /**
   * The title is the thing a stranger must not get, and the branch above is
   * what guarantees it: `plan` is null there, so there is nothing to render.
   * Pinned because "say it isn't here" and "say whose it is" are one careless
   * edit apart.
   */
  it('names nothing about the plan while doing so', async () => {
    primeMissing({ data: null, error: notFound });
    await renderDetail();

    await waitFor(() => expect(screen.getByTestId('plan-error')).toBeTruthy());
    expect(screen.queryByText(basePlan.title)).toBeNull();
    expect(screen.queryByText(basePlan.groups.name)).toBeNull();
  });

  it('offers a way back when there is a screen behind it', async () => {
    mockCanGoBack = true;
    primeMissing({ data: null, error: notFound });
    await renderDetail();

    await waitFor(() => expect(screen.getByTestId('plan-error-back')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('plan-error-back'));
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('sends a cold deep link to the feed, since there is nothing to go back to', async () => {
    mockCanGoBack = false;
    primeMissing({ data: null, error: notFound });
    await renderDetail();

    await waitFor(() => expect(screen.getByTestId('plan-error-back')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('plan-error-back'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
    expect(mockBack).not.toHaveBeenCalled();
  });

  /**
   * PLA-81: a shared link is the one door into this screen with no session
   * behind it, and RLS gives an anonymous request the same empty answer it
   * gives a stranger. Telling someone their own group's plan isn't here is the
   * one wrong answer available, so the screen holds the plan and leaves.
   */
  it('holds the plan and goes to sign in when there is no session', async () => {
    useAuthStore.setState({ session: null, user: null });
    primeMissing({ data: null, error: notFound });
    await renderDetail();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/login'));
    expect(takePendingPlan()).toBe('plan-1');
    expect(screen.queryByTestId('plan-error')).toBeNull();
    expect(screen.queryByText("This plan isn't here")).toBeNull();
  });

  it('asks the database nothing at all without a session', async () => {
    useAuthStore.setState({ session: null, user: null });
    primeMissing({ data: null, error: notFound });
    await renderDetail();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/login'));
    expect(mockFrom).not.toHaveBeenCalledWith('plans');
    expect(mockFrom).not.toHaveBeenCalledWith('rsvps');
  });

  it('offers a retry when the fetch failed rather than came back empty', async () => {
    primeMissing({ data: null, error: new Error('Failed to reach Supabase at https://x/') });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("Couldn't reach Planazo")).toBeTruthy());
    expect(screen.getByTestId('plan-error-retry')).toBeTruthy();
  });
});
