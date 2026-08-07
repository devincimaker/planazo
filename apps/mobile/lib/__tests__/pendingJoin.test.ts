import { stashPendingJoin, takePendingJoin } from '../pendingJoin';

// Module state, so every test starts by draining whatever the last one left.
beforeEach(() => {
  takePendingJoin();
});

describe('pendingJoin', () => {
  it('has nothing to hand back before anything is stashed', () => {
    expect(takePendingJoin()).toBeNull();
  });

  it('gives a stashed code back once and then forgets it', () => {
    stashPendingJoin('ABCD2345');

    expect(takePendingJoin()).toBe('ABCD2345');
    expect(takePendingJoin()).toBeNull();
  });

  it('keeps only the most recent code', () => {
    stashPendingJoin('ABCD2345');
    stashPendingJoin('K4M7P2QR');

    expect(takePendingJoin()).toBe('K4M7P2QR');
  });
});
