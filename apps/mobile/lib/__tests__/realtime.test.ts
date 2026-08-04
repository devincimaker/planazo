import { renderHook, act } from '@testing-library/react-native';
import React from 'react';
import { AppState } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  keysForChange,
  useRealtimeCacheSync,
  FLUSH_DELAY_MS,
  SUBSCRIBED_TABLES,
} from '../realtime';
import { supabase } from '../supabase';
import { useAuthStore } from '../../stores/authStore';

type Listener = (payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) => void;

// Each channel records its listeners per table so tests can push synthetic
// payloads through the exact callback the hook registered.
type MockChannel = {
  listeners: Map<string, Listener>;
  on: jest.Mock;
  subscribe: jest.Mock;
};

function makeChannel(): MockChannel {
  const listeners = new Map<string, Listener>();
  const channel: MockChannel = {
    listeners,
    on: jest.fn((_event: string, filter: { table: string }, cb: Listener) => {
      listeners.set(filter.table, cb);
      return channel;
    }),
    subscribe: jest.fn(() => channel),
  };
  return channel;
}

jest.mock('../supabase', () => ({
  supabase: {
    channel: jest.fn(),
    removeChannel: jest.fn().mockResolvedValue('ok'),
  },
}));

const mockChannelFactory = supabase.channel as unknown as jest.Mock;
const mockRemoveChannel = supabase.removeChannel as unknown as jest.Mock;

describe('keysForChange', () => {
  it.each([
    [
      'rsvps with a plan id',
      'rsvps',
      { plan_id: 'p1', user_id: 'u1' },
      [['plan-rsvps', 'p1'], ['home-plans'], ['group'], ['groups']],
    ],
    [
      'rsvps delete (old row is only the primary key)',
      'rsvps',
      { id: 'row1' },
      [['plan-rsvps'], ['home-plans'], ['group'], ['groups']],
    ],
    [
      'date_availability with a plan id',
      'date_availability',
      { plan_id: 'p2' },
      [['plan-availabilities', 'p2'], ['home-plans'], ['group'], ['groups']],
    ],
    [
      'date_availability delete',
      'date_availability',
      { id: 'row2' },
      [['plan-availabilities'], ['home-plans'], ['group'], ['groups']],
    ],
    [
      'plans insert/update',
      'plans',
      { id: 'p3', group_id: 'g1' },
      [['plan', 'p3'], ['home-plans'], ['group', 'g1'], ['groups'], ['cancel-notices']],
    ],
    [
      'plans delete (primary key still names the plan)',
      'plans',
      { id: 'p3' },
      [['plan', 'p3'], ['home-plans'], ['group'], ['groups'], ['cancel-notices']],
    ],
    [
      'group_members insert/update',
      'group_members',
      { group_id: 'g2', user_id: 'u2' },
      [
        ['group', 'g2'],
        ['groups'],
        ['my-groups'],
        ['home-plans'],
        ['plan-membership'],
        ['plan-group-member-ids', 'g2'],
      ],
    ],
    [
      'group_members delete',
      'group_members',
      { id: 'row3' },
      [
        ['group'],
        ['groups'],
        ['my-groups'],
        ['home-plans'],
        ['plan-membership'],
        ['plan-group-member-ids'],
      ],
    ],
  ] as const)('%s', (_name, table, record, expected) => {
    expect(keysForChange(table as any, record as any)).toEqual(expected);
  });
});

describe('useRealtimeCacheSync', () => {
  let queryClient: QueryClient;
  let invalidateSpy: jest.SpyInstance;
  let appStateHandler: ((status: string) => void) | null;

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  const mount = () => renderHook(() => useRealtimeCacheSync(), { wrapper: Wrapper });

  const latestChannel = () =>
    mockChannelFactory.mock.results[mockChannelFactory.mock.results.length - 1]?.value;

  beforeEach(() => {
    jest.useFakeTimers();
    mockChannelFactory.mockReset().mockImplementation(() => makeChannel());
    mockRemoveChannel.mockClear();
    queryClient = new QueryClient();
    invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    appStateHandler = null;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type: string, handler: any) => {
        appStateHandler = handler;
        return { remove: jest.fn() } as any;
      });
    // A plain writable field on the AppState instance, so assignment is enough.
    (AppState as any).currentState = 'active';
    useAuthStore.setState({ user: { id: 'user-1' } as any });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it('opens one channel with a listener per table while signed in and active', async () => {
    await mount();

    expect(mockChannelFactory).toHaveBeenCalledTimes(1);
    const channel = latestChannel();
    expect(channel.on).toHaveBeenCalledTimes(SUBSCRIBED_TABLES.length);
    expect([...channel.listeners.keys()].sort()).toEqual([...SUBSCRIBED_TABLES].sort());
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe with no signed-in user', async () => {
    useAuthStore.setState({ user: null });
    await mount();
    expect(mockChannelFactory).not.toHaveBeenCalled();
    expect(appStateHandler).toBeNull();
  });

  it('pools a burst of events into one debounced invalidation pass', async () => {
    await mount();
    const fire = latestChannel().listeners.get('rsvps')!;

    await act(() => {
      fire({ eventType: 'INSERT', new: { plan_id: 'p1' }, old: {} });
      fire({ eventType: 'UPDATE', new: { plan_id: 'p1' }, old: {} });
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    await act(() => {
      jest.advanceTimersByTime(FLUSH_DELAY_MS);
    });

    // Two events, identical keys: each distinct key invalidated exactly once.
    expect(invalidateSpy).toHaveBeenCalledTimes(4);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['plan-rsvps', 'p1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['home-plans'] });
  });

  it('reads the old row for deletes', async () => {
    await mount();
    const fire = latestChannel().listeners.get('rsvps')!;

    await act(() => {
      fire({ eventType: 'DELETE', new: {}, old: { id: 'row1' } });
      jest.advanceTimersByTime(FLUSH_DELAY_MS);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['plan-rsvps'] });
  });

  it('tears down on background and resubscribes on return, dropping pooled work', async () => {
    await mount();
    const fire = latestChannel().listeners.get('plans')!;

    await act(() => {
      fire({ eventType: 'UPDATE', new: { id: 'p1', group_id: 'g1' }, old: {} });
      appStateHandler!('background');
    });

    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    // The pooled invalidation must not fire from the background.
    await act(() => {
      jest.advanceTimersByTime(FLUSH_DELAY_MS * 2);
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    await act(() => {
      appStateHandler!('active');
    });
    expect(mockChannelFactory).toHaveBeenCalledTimes(2);
  });

  it('does not double-subscribe on repeated active transitions', async () => {
    await mount();
    await act(() => {
      appStateHandler!('active');
      appStateHandler!('active');
    });
    expect(mockChannelFactory).toHaveBeenCalledTimes(1);
  });

  it('tears down when the user signs out and on unmount', async () => {
    const { rerender, unmount } = await mount();

    useAuthStore.setState({ user: null });
    await rerender({});
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);

    useAuthStore.setState({ user: { id: 'user-2' } as any });
    await rerender({});
    expect(mockChannelFactory).toHaveBeenCalledTimes(2);

    await unmount();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(2);
  });
});
