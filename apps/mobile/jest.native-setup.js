// Minimal React Native setup for Jest
// This replaces react-native/jest/setup.js which has ESM import issues in RN 0.81+

// Set up global mocks commonly needed for React Native
global.__DEV__ = true;

// Mock the React Native bridge config that's normally set by native code
global.__fbBatchedBridgeConfig = {
  remoteModuleConfig: [],
  localModulesConfig: [],
};

// Mock fetch if not available
if (typeof global.fetch === 'undefined') {
  global.fetch = jest.fn();
}

// Mock console methods that might be noisy in tests
const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  // Filter out React Native specific warnings
  if (typeof args[0] === 'string' && args[0].includes('Animated')) {
    return;
  }
  originalConsoleWarn(...args);
};
