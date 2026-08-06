import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EditPlanScreen from '../edit';
import { supabase } from '../../../../../lib/supabase';

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'plan-1' }),
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));


const mockFrom = supabase.from as jest.Mock;

const PLAN = {
  id: 'plan-1',
  group_id: 'group-1',
  created_by: 'me',
  title: 'Padel',
  location: 'Club Vall d’Hebron',
  description: 'Bring cash',
  status: 'open',
  plan_type: 'fixed',
  min_people: 4,
  max_people: null,
};

let planUpdate: jest.Mock;

/**
 * One builder serves both statements this screen makes: the read that fills
 * the fields and the write that saves them. Which one it resolves as is
 * decided by whether `.update()` was called on it.
 */
function primeSupabase(updateResult: unknown = { data: [{ id: 'plan-1' }], error: null }) {
  planUpdate = jest.fn();
  mockFrom.mockImplementation(() => {
    const c: any = {};
    let writing = false;
    ['select', 'eq', 'single'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    c.update = jest.fn((values: Record<string, unknown>) => {
      writing = true;
      planUpdate(values);
      return c;
    });
    c.then = (resolve: (v: unknown) => void) =>
      Promise.resolve(writing ? updateResult : { data: PLAN, error: null }).then(resolve);
    return c;
  });
}

async function renderEdit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <EditPlanScreen />
    </QueryClientProvider>
  );
  // Fields start empty and fill from the query.
  await waitFor(() => expect(screen.getByTestId('title-input').props.value).toBe('Padel'));
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  primeSupabase();
});

describe('EditPlanScreen', () => {
  it('shows what the plan says now', async () => {
    await renderEdit();

    expect(screen.getByTestId('location-input').props.value).toBe('Club Vall d’Hebron');
    expect(screen.getByTestId('notes-input').props.value).toBe('Bring cash');
  });

  it('Save stays grey until something actually changed', async () => {
    await renderEdit();

    await fireEvent.press(screen.getByTestId('save'));
    expect(planUpdate).not.toHaveBeenCalled();

    // Retyping the same title is not a change, and neither is whitespace.
    await fireEvent.changeText(screen.getByTestId('title-input'), 'Padel ');
    await fireEvent.press(screen.getByTestId('save'));
    expect(planUpdate).not.toHaveBeenCalled();
  });

  it('refuses to save a plan with no title', async () => {
    await renderEdit();

    await fireEvent.changeText(screen.getByTestId('title-input'), '   ');
    await fireEvent.press(screen.getByTestId('save'));
    expect(planUpdate).not.toHaveBeenCalled();
  });

  it('saves the three fields trimmed, clearing the place to null, then closes', async () => {
    await renderEdit();

    await fireEvent.changeText(screen.getByTestId('title-input'), '  Padel at the club  ');
    await fireEvent.changeText(screen.getByTestId('location-input'), '   ');
    await fireEvent.press(screen.getByTestId('save'));

    await waitFor(() => {
      expect(planUpdate).toHaveBeenCalledWith({
        title: 'Padel at the club',
        location: null,
        description: 'Bring cash',
      });
      expect(mockBack).toHaveBeenCalled();
    });
  });

  // Guideline 1.2: the filter runs before the write, wherever the text is typed.
  it('stops objectionable language before it reaches the database', async () => {
    await renderEdit();

    await fireEvent.changeText(screen.getByTestId('notes-input'), 'no retards allowed');
    await fireEvent.press(screen.getByTestId('save'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        expect.stringContaining('language that isn’t allowed')
      )
    );
    expect(planUpdate).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  // PLA-16's shape: PostgREST answers 200 with no rows when the policy filtered
  // the row out. Closing the screen on that would report a save that never was.
  it('says so when the update comes back with no rows', async () => {
    primeSupabase({ data: [], error: null });
    await renderEdit();

    await fireEvent.changeText(screen.getByTestId('title-input'), 'Padel at nine');
    await fireEvent.press(screen.getByTestId('save'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        expect.stringContaining("You're not the host of this plan any more")
      )
    );
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('reports a failed write instead of closing', async () => {
    primeSupabase({ data: null, error: { message: 'permission denied for table plans' } });
    await renderEdit();

    await fireEvent.changeText(screen.getByTestId('title-input'), 'Padel at nine');
    await fireEvent.press(screen.getByTestId('save'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'permission denied for table plans')
    );
    expect(mockBack).not.toHaveBeenCalled();
  });
});
