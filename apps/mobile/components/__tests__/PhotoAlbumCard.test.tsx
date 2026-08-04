import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PhotoAlbumCard } from '../PhotoAlbumCard';
import { usePlanPhotos } from '../../lib/usePlanPhotos';

// photos.ts reaches the supabase client through lib/images, which reads env
// at import time. The card never touches it in these tests.
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), storage: {} } }));

jest.mock('../../lib/usePlanPhotos', () => ({
  usePlanPhotos: jest.fn(),
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

const mockUsePlanPhotos = usePlanPhotos as jest.Mock;

function photo(id: string, uploader: string, name: string) {
  return {
    id,
    plan_id: 'plan-1',
    uploaded_by: uploader,
    storage_path: `plan-1/${uploader}/${id}.jpg`,
    thumb_path: `plan-1/${uploader}/${id}_thumb.jpg`,
    width: 900,
    height: 900,
    created_at: '2026-08-03T10:00:00Z',
    uploader: { display_name: name },
  };
}

function prime(rows: ReturnType<typeof photo>[], error: unknown = null) {
  mockUsePlanPhotos.mockReturnValue({
    rows,
    signed: rows.map((r) => ({
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
    prime([]);
    renderCard({ albumOpen: false });
    await waitFor(() => expect(screen.queryByTestId('photo-album-card')).toBeNull());
  });

  // An empty album you are not allowed to fill is a locked door, so a
  // bystander sees it only once somebody has put something in it.
  it('renders nothing when it is empty and you cannot add', async () => {
    prime([]);
    renderCard({ canAdd: false });
    await waitFor(() => expect(screen.queryByTestId('photo-album-card')).toBeNull());
  });

  it('invites the first photo when it is empty and you can add', async () => {
    prime([]);
    renderCard();
    await waitFor(() => expect(screen.getByTestId('photo-album-card')).toBeTruthy());
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    expect(screen.getByText('The first photo of the night goes here')).toBeTruthy();
    expect(screen.getByTestId('add-photos')).toBeTruthy();
  });

  it('names the one person who posted a single photo', async () => {
    prime([photo('p1', 'lucia', 'Lucía')]);
    renderCard();
    await waitFor(() => expect(screen.getByText('One photo, from Lucía')).toBeTruthy());
  });

  it('counts the people once there are several', async () => {
    prime([
      photo('p1', 'a', 'Alex'),
      photo('p2', 'b', 'Bianca'),
      photo('p3', 'c', 'Diego'),
      photo('p4', 'd', 'Maya'),
      photo('p5', 'e', 'Sam'),
    ]);
    renderCard();
    await waitFor(() => expect(screen.getByText('5 photos from five people')).toBeTruthy());
  });

  // One person's holiday album should not say "from one people".
  it('names the uploader when several photos all came from them', async () => {
    prime([photo('p1', 'a', 'Alex'), photo('p2', 'a', 'Alex')]);
    renderCard();
    await waitFor(() => expect(screen.getByText('2 photos from Alex')).toBeTruthy());
  });

  it('says the album is full at the plan ceiling', async () => {
    prime(Array.from({ length: 200 }, (_, i) => photo(`p${i}`, `u${i % 7}`, 'Someone')));
    renderCard();
    await waitFor(() => expect(screen.getByText('This album is full')).toBeTruthy());
  });

  // Your own ceiling reads differently: the album still has room, you don't.
  it('separates your own ceiling from the album being full', async () => {
    prime(Array.from({ length: 20 }, (_, i) => photo(`p${i}`, 'me', 'You')));
    renderCard();
    await waitFor(() =>
      expect(screen.getByText("You've added your 20 photos to this plan.")).toBeTruthy(),
    );
    expect(screen.queryByText('This album is full')).toBeNull();
  });

  // A failed read is not an empty album. Claiming emptiness it cannot verify
  // tells someone their night was never recorded.
  it('says the album could not be read rather than that it is empty', async () => {
    prime([], new Error('network'));
    renderCard();
    await waitFor(() => expect(screen.queryByText('Nothing here yet.')).toBeNull());
    expect(screen.getByText('Photos')).toBeTruthy();
  });
});
