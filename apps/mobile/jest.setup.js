/**
 * Nineteen test files used to carry their own byte-identical
 * `jest.mock('react-native-safe-area-context', …)`, and the twentieth screen to
 * need one found out by watching its render throw. They all wanted the same
 * thing: zero insets, and SafeAreaView out of the way. So it lives here once
 * (PLA-73).
 *
 * `SafeAreaInsetsContext` defaults to `null` exactly as the real module does,
 * so a component that reads it without a provider sees what it would see on a
 * device with no provider mounted, rather than a comfortable zero.
 *
 * An inline `jest.mock` in a test file still wins over this, which is the way
 * to opt out when a test genuinely needs different insets.
 */
jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  const zero = { top: 0, bottom: 0, left: 0, right: 0 };

  return {
    useSafeAreaInsets: () => zero,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
    SafeAreaInsetsContext: React.createContext(null),
    SafeAreaView: ({ children }) => children,
    SafeAreaProvider: ({ children }) => children,
    initialWindowMetrics: { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: zero },
  };
});
