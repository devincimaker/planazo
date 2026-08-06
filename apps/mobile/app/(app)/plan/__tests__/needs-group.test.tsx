import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import NeedsGroupSheet from '../needs-group';

const mockBack = jest.fn();
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
/** False on a cold deep link: the sheet opens with nothing behind it. */
let mockCanGoBack = true;

// The ui barrel reaches Supabase transitively; this screen never calls it.
jest.mock('../../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    navigate: mockNavigate,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
});

describe('NeedsGroupSheet', () => {
  it('says why a plan cannot be made yet and offers both ways out', async () => {
    await render(<NeedsGroupSheet />);

    expect(screen.getByText('Plans need a group first')).toBeTruthy();
    expect(screen.getByTestId('sort-out-group')).toBeTruthy();
    expect(screen.getByTestId('not-now')).toBeTruthy();
  });

  it('dismisses the sheet before changing the tab underneath it', async () => {
    await render(<NeedsGroupSheet />);

    await fireEvent.press(screen.getByTestId('sort-out-group'));
    expect(mockBack).toHaveBeenCalled();
    // Deliberately deferred until the sheet is gone.
    expect(mockNavigate).not.toHaveBeenCalled();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(app)/(tabs)/groups'));
  });

  it('puts "Not now" straight back where it came from', async () => {
    await render(<NeedsGroupSheet />);

    await fireEvent.press(screen.getByTestId('not-now'));
    expect(mockBack).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  /**
   * A cold deep link opens this with nothing behind it, and back() is a no-op
   * that logs "GO_BACK was not handled by any navigator". Both buttons used
   * it, so the sheet could not be left at all.
   */
  it('replaces itself when there is nothing to go back to', async () => {
    mockCanGoBack = false;
    await render(<NeedsGroupSheet />);

    await fireEvent.press(screen.getByTestId('sort-out-group'));
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)/groups');

    await fireEvent.press(screen.getByTestId('not-now'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
  });
});
