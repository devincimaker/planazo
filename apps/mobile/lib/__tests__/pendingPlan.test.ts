import { stashPendingPlan, takePendingPlan } from '../pendingPlan';

// Module state, so every test starts by draining whatever the last one left.
beforeEach(() => {
  takePendingPlan();
});

describe('pendingPlan', () => {
  it('has nothing to hand back before anything is stashed', () => {
    expect(takePendingPlan()).toBeNull();
  });

  it('gives a stashed plan back once and then forgets it', () => {
    stashPendingPlan('plan-1');

    expect(takePendingPlan()).toBe('plan-1');
    expect(takePendingPlan()).toBeNull();
  });

  it('keeps only the most recent plan', () => {
    stashPendingPlan('plan-1');
    stashPendingPlan('plan-2');

    expect(takePendingPlan()).toBe('plan-2');
  });
});
