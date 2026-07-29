import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreatePlanScreen from '../create';
import { useAuthStore } from '../../../../stores/authStore';
import { supabase } from '../../../../lib/supabase';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string | undefined> = {};

jest.mock('../../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

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

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(View, { testID: 'time-picker' }),
  };
});

const mockFrom = supabase.from as jest.Mock;

/** Chainable, awaitable Supabase query-builder stub. */
function chain(result: unknown) {
  const c: any = {};
  ['select', 'eq', 'in', 'order', 'insert', 'upsert', 'delete', 'single'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return c;
}

const MEMBERSHIPS = [
  { groups: { id: 'g1', name: 'Los de siempre' } },
  { groups: { id: 'g2', name: 'Escapistas' } },
];

let plansChain: ReturnType<typeof chain>;
let optionsChain: ReturnType<typeof chain>;

function primeSupabase() {
  plansChain = chain({ data: { id: 'new-plan' }, error: null });
  optionsChain = chain({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'group_members') return chain({ data: MEMBERSHIPS, error: null });
    if (table === 'plans') return plansChain;
    if (table === 'plan_date_options') return optionsChain;
    return chain({ data: null, error: null });
  });
}

async function renderCreate() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CreatePlanScreen />
    </QueryClientProvider>
  );
}

// Freeze only Date (timers stay real so async rendering works):
// today is Wed 2026-08-05, so days 6+ of August are pickable.
beforeAll(() => {
  jest.useFakeTimers({
    now: new Date('2026-08-05T10:00:00'),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  primeSupabase();
  useAuthStore.setState({
    user: { id: 'me' } as any,
    profile: { id: 'me', display_name: 'Rocío', avatar_url: null } as any,
  });
});

describe('CreatePlanScreen', () => {
  it('shows all group chips with the first preselected and named in the CTA', async () => {
    await renderCreate();

    await screen.findByTestId('group-g1');
    expect(screen.getByTestId('group-g2')).toBeTruthy();
    expect(screen.getByTestId('group-g1')).toBeSelected();
    expect(screen.getByText('Post to Los de siempre')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('group-g2'));
    expect(screen.getByTestId('group-g2')).toBeSelected();
    expect(screen.getByText('Post to Escapistas')).toBeTruthy();
  });

  it('collapses the chip row to one group when opened with groupId', async () => {
    mockParams = { groupId: 'g2' };
    await renderCreate();

    await screen.findByTestId('group-g2');
    expect(screen.queryByTestId('group-g1')).toBeNull();
    expect(screen.getByText('Post to Escapistas')).toBeTruthy();
  });

  it('treats an empty groupId param as absent', async () => {
    mockParams = { groupId: '' };
    await renderCreate();

    await screen.findByTestId('group-g1');
    expect(screen.getByTestId('group-g2')).toBeTruthy();
    expect(screen.getByTestId('group-g1')).toBeSelected();
    expect(screen.getByText('Post to Los de siempre')).toBeTruthy();
  });

  it('one tapped day means fixed: summary, chip and time field appear', async () => {
    await renderCreate();
    await screen.findByTestId('group-g1');

    expect(screen.getByText('Pick a date — or a few, and let them vote.')).toBeTruthy();
    expect(screen.queryByText('Starts at')).toBeNull();

    await fireEvent.press(screen.getByTestId('cal-day-2026-08-07'));

    expect(screen.getByText('Fixed date · Friday 7 August')).toBeTruthy();
    expect(screen.getByTestId('chip-2026-08-07')).toBeTruthy();
    expect(screen.getByText('Starts at')).toBeTruthy();
    expect(screen.getByText('20:30')).toBeTruthy();
    expect(screen.queryByText("You'll set the time once a date wins.")).toBeNull();
  });

  it('two tapped days mean flexible: options summary and time hint instead of time field', async () => {
    await renderCreate();
    await screen.findByTestId('group-g1');

    await fireEvent.press(screen.getByTestId('cal-day-2026-08-07'));
    await fireEvent.press(screen.getByTestId('cal-day-2026-08-09'));

    expect(screen.getByText('2 options · everyone ticks what works')).toBeTruthy();
    expect(screen.queryByText('Starts at')).toBeNull();
    expect(screen.getByText("You'll set the time once a date wins.")).toBeTruthy();
  });

  it('removes a picked day from its chip', async () => {
    await renderCreate();
    await screen.findByTestId('group-g1');

    await fireEvent.press(screen.getByTestId('cal-day-2026-08-07'));
    await fireEvent.press(screen.getByTestId('cal-day-2026-08-09'));
    await fireEvent.press(screen.getByTestId('chip-2026-08-07'));

    expect(screen.queryByTestId('chip-2026-08-07')).toBeNull();
    expect(screen.getByText('Fixed date · Sunday 9 August')).toBeTruthy();
  });

  it('past days are dead and month arrows clamp at the current month', async () => {
    await renderCreate();
    await screen.findByTestId('group-g1');

    await fireEvent.press(screen.getByTestId('cal-day-2026-08-03'));
    expect(screen.queryByTestId('chip-2026-08-03')).toBeNull();

    expect(screen.getByText('August 2026')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('cal-prev'));
    expect(screen.getByText('August 2026')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('cal-next'));
    expect(screen.getByText('September 2026')).toBeTruthy();
  });

  it('steppers respect the floor of 2 and the cap dropping back to No limit', async () => {
    await renderCreate();
    await screen.findByTestId('group-g1');

    expect(screen.getByTestId('min-value')).toHaveTextContent('4');
    expect(screen.getByTestId('cap-value')).toHaveTextContent('—');
    expect(screen.getByText('No limit')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('min-down'));
    await fireEvent.press(screen.getByTestId('min-down'));
    await fireEvent.press(screen.getByTestId('min-down'));
    expect(screen.getByTestId('min-value')).toHaveTextContent('2');

    await fireEvent.press(screen.getByTestId('cap-up'));
    expect(screen.getByTestId('cap-value')).toHaveTextContent('2');

    await fireEvent.press(screen.getByTestId('cap-down'));
    expect(screen.getByTestId('cap-value')).toHaveTextContent('—');
    expect(screen.getByText('No limit')).toBeTruthy();
  });

  it('cap can equal the min for an exact-headcount plan', async () => {
    await renderCreate();
    await screen.findByTestId('group-g1');

    await fireEvent.press(screen.getByTestId('cap-up'));
    expect(screen.getByTestId('cap-value')).toHaveTextContent('4');

    await fireEvent.changeText(screen.getByTestId('title-input'), 'Padel');
    await fireEvent.press(screen.getByTestId('cal-day-2026-08-07'));
    await fireEvent.press(screen.getByTestId('post-cta'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(plansChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ min_people: 4, max_people: 4 })
    );
  });

  it('raising the floor into the cap drags the cap along to match', async () => {
    await renderCreate();
    await screen.findByTestId('group-g1');

    await fireEvent.press(screen.getByTestId('cap-up'));
    expect(screen.getByTestId('cap-value')).toHaveTextContent('4');

    await fireEvent.press(screen.getByTestId('min-up'));
    expect(screen.getByTestId('min-value')).toHaveTextContent('5');
    expect(screen.getByTestId('cap-value')).toHaveTextContent('5');

    await fireEvent.press(screen.getByTestId('cap-down'));
    expect(screen.getByTestId('cap-value')).toHaveTextContent('—');
  });

  it('does not post until there is a title and a date', async () => {
    await renderCreate();
    await screen.findByTestId('group-g1');

    await fireEvent.press(screen.getByTestId('post-cta'));
    expect(plansChain.insert).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('title-input'), 'Padel + pizza');
    await fireEvent.press(screen.getByTestId('post-cta'));
    expect(plansChain.insert).not.toHaveBeenCalled();
  });

  it('posts a fixed plan with the date and default time', async () => {
    await renderCreate();
    await screen.findByTestId('group-g1');

    await fireEvent.changeText(screen.getByTestId('title-input'), 'Padel + pizza');
    await fireEvent.press(screen.getByTestId('cal-day-2026-08-07'));
    await fireEvent.press(screen.getByTestId('post-cta'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(plansChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        group_id: 'g1',
        created_by: 'me',
        title: 'Padel + pizza',
        plan_type: 'fixed',
        event_date: new Date(2026, 7, 7, 20, 30).toISOString(),
        min_people: 4,
        max_people: null,
        status: 'open',
      })
    );
    expect(optionsChain.insert).not.toHaveBeenCalled();
  });

  it('posts a flexible plan with one option row per date', async () => {
    await renderCreate();
    await screen.findByTestId('group-g1');

    await fireEvent.changeText(screen.getByTestId('title-input'), 'Escape room revenge');
    await fireEvent.press(screen.getByTestId('cal-day-2026-08-07'));
    await fireEvent.press(screen.getByTestId('cal-day-2026-08-09'));
    await fireEvent.press(screen.getByTestId('post-cta'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(plansChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ plan_type: 'flexible', event_date: null })
    );
    expect(optionsChain.insert).toHaveBeenCalledWith([
      { plan_id: 'new-plan', date: new Date('2026-08-07').toISOString() },
      { plan_id: 'new-plan', date: new Date('2026-08-09').toISOString() },
    ]);
  });

  it('folds place & notes into the post', async () => {
    await renderCreate();
    await screen.findByTestId('group-g1');

    expect(screen.queryByTestId('location-input')).toBeNull();
    await fireEvent.press(screen.getByTestId('details-toggle'));
    expect(screen.getByText('Hide extras')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('location-input'), 'Padel Indoor Gràcia');
    await fireEvent.changeText(screen.getByTestId('notes-input'), 'Bring cash');
    await fireEvent.changeText(screen.getByTestId('title-input'), 'Padel');
    await fireEvent.press(screen.getByTestId('cal-day-2026-08-07'));
    await fireEvent.press(screen.getByTestId('post-cta'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(plansChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        location: 'Padel Indoor Gràcia',
        description: 'Bring cash',
      })
    );
  });
});
