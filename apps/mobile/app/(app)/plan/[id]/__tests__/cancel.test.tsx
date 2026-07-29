import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CancelPlanScreen from '../cancel';
import { supabase } from '../../../../../lib/supabase';

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'plan-1' }),
  useRouter: () => ({ push: jest.fn(), back: mockBack }),
}));

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

function chain(result: unknown) {
  const c: any = {};
  ['select', 'eq', 'single'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return c;
}

function prime(plan: Record<string, unknown>, rsvps: unknown[] = []) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'plans') return chain({ data: plan, error: null });
    if (table === 'rsvps') return chain({ data: rsvps, error: null });
    if (table === 'date_availability') return chain({ data: [], error: null });
    return chain({ data: null, error: null });
  });
  mockRpc.mockResolvedValue({ data: {}, error: null });
}

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <CancelPlanScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => jest.clearAllMocks());

describe('CancelPlanScreen (20b)', () => {
  const plan = {
    id: 'plan-1',
    group_id: 'g1',
    title: 'Five-a-side at Powerleague',
    plan_type: 'fixed',
    status: 'open',
  };

  it('names the cost out loud and sends the reason with the RPC', async () => {
    prime(plan, [
      { user_id: 'a', response: 'yes' },
      { user_id: 'b', response: 'yes' },
      { user_id: 'c', response: 'no' },
    ]);
    await renderSheet();

    await waitFor(() =>
      expect(screen.getByText('Call off “Five-a-side at Powerleague”?')).toBeTruthy()
    );
    expect(
      screen.getByText(
        "2 people said they're coming. They'll all get a notification straight away, and the plan moves to Past."
      )
    ).toBeTruthy();
    expect(screen.getByText('This goes in the notification and stays on the plan.')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('cancel-reason'), 'Pitch flooded.');
    await fireEvent.press(screen.getByTestId('confirm-cancel'));

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('cancel_plan', {
        p_plan_id: 'plan-1',
        p_reason: 'Pitch flooded.',
      })
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('skipping the reason sends null, and Keep it just dismisses', async () => {
    prime(plan, []);
    await renderSheet();

    await waitFor(() =>
      expect(screen.getByText('No one has answered yet. The plan moves to Past.')).toBeTruthy()
    );

    await fireEvent.press(screen.getByTestId('keep-it'));
    expect(mockBack).toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('cancel_plan', {
        p_plan_id: 'plan-1',
        p_reason: null,
      })
    );
  });
});
