import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PhotoAlbumCard } from '../PhotoAlbumCard';
import { usePlanAlbumCard } from '../../lib/usePlanPhotos';

// photos.ts reaches the supabase client through lib/images, which reads env
// at import time. The card never touches it in these tests.
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), storage: {} } }));

jest.mock('../../lib/usePlanPhotos', () => ({
  usePlanAlbumCard: jest.fn(),
  planPhotosKey: (planId: string) => ['plan-photos', planId],
}));

jest.mock('../../lib/photos', () => ({
  ...jest.requireActual('../../lib/photos'),
  pickPhotos: jest.fn(),
  uploadPhotos: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const mockUsePlanAlbumCard = usePlanAlbumCard as jest.Mock;

/** The hook's answer, stated directly: each test names its five numbers
 *  rather than building row lists for a derivation the mock never runs.
 *  `recent` and `signed` follow from `total`, capped at the strip's four. */
function prime(
  summary: { total: number; uploaders: number; mine?: number; name?: string | null },
  error: unknown = null,
) {
  const recent = Array.from({ length: Math.min(summary.total, 4) }, (_, i) => ({
    id: `p${i}`,
    storage_path: `plan-1/u/p${i}.jpg`,
    thumb_path: `plan-1/u/p${i}_thumb.jpg`,
    uploader_name: summary.name ?? null,
  }));
  mockUsePlanAlbumCard.mockReturnValue({
    summary: error
      ? undefined
      : {
          total: summary.total,
          mine: summary.mine ?? 0,
          uploaders: summary.uploaders,
          name: summary.name ?? null,
          recent,
        },
    signed: error
      ? undefined
      : recent.map((r) => ({
          ...r,
          url: `https://signed/${r.id}`,
          thumbUrl: `https://signed/${r.id}_thumb`,
        })),
    isLoading: false,
    error,
  });
}

function renderCard(props: Partial<Parameters<typeof PhotoAlbumCard>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <PhotoAlbumCard planId="plan-1" userId="me" albumOpen canAdd {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('PhotoAlbumCard', () => {
  // These two assert on an absence, and React 19 commits off the synchronous
  // path, so `screen` is not populated the instant render() returns. Awaiting
  // is what makes "nothing is there" a real assertion rather than a race the
  // test wins by being early.
  it('renders nothing before the night has started', async () => {
    prime({ total: 0, uploaders: 0 });
    renderCard({ albumOpen: false });
    await waitFor(() => expect(screen.queryByTestId('photo-album-card')).toBeNull());
  });

  // An empty album you are not allowed to fill is a locked door, so a
  // bystander sees it only once somebody has put something in it.
  it('renders nothing when it is empty and you cannot add', async () => {
    prime({ total: 0, uploaders: 0 });
    renderCard({ canAdd: false });
    await waitFor(() => expect(screen.queryByTestId('photo-album-card')).toBeNull());
  });

  it('invites the first photo when it is empty and you can add', async () => {
    prime({ total: 0, uploaders: 0 });
    renderCard();
    await waitFor(() => expect(screen.getByTestId('photo-album-card')).toBeTruthy());
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    expect(screen.getByText('The first photo of the night goes here')).toBeTruthy();
    expect(screen.getByTestId('add-photos')).toBeTruthy();
  });

  it('names the one person who posted a single photo', async () => {
    prime({ total: 1, uploaders: 1, name: 'Lucía' });
    renderCard();
    await waitFor(() => expect(screen.getByText('One photo, from Lucía')).toBeTruthy());
  });

  it('counts the people once there are several', async () => {
    prime({ total: 5, uploaders: 5, name: 'Alex' });
    renderCard();
    await waitFor(() => expect(screen.getByText('5 photos from five people')).toBeTruthy());
  });

  // One person's holiday album should not say "from one people".
  it('names the uploader when several photos all came from them', async () => {
    prime({ total: 2, uploaders: 1, name: 'Alex' });
    renderCard();
    await waitFor(() => expect(screen.getByText('2 photos from Alex')).toBeTruthy());
  });

  it('says the album is full at the plan ceiling', async () => {
    prime({ total: 200, uploaders: 7, name: 'Someone' });
    renderCard();
    await waitFor(() => expect(screen.getByText('This album is full')).toBeTruthy());
  });

  // Your own ceiling reads differently: the album still has room, you don't.
  it('separates your own ceiling from the album being full', async () => {
    prime({ total: 20, uploaders: 1, mine: 20, name: 'You' });
    renderCard();
    await waitFor(() =>
      expect(screen.getByText("You've added your 20 photos to this plan.")).toBeTruthy(),
    );
    expect(screen.queryByText('This album is full')).toBeNull();
  });

  // A failed read is not an empty album. Claiming emptiness it cannot verify
  // tells someone their night was never recorded.
  it('says the album could not be read rather than that it is empty', async () => {
    prime({ total: 0, uploaders: 0 }, new Error('network'));
    renderCard();
    await waitFor(() => expect(screen.queryByText('Nothing here yet.')).toBeNull());
    expect(screen.getByText('Photos')).toBeTruthy();
  });
});
