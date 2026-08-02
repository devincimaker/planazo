/**
 * Automatic manual mock (jest resolves node-module mocks from __mocks__).
 * Keeps component tests off Sentry's native module: everything is a no-op,
 * `wrap` and `ErrorBoundary` render straight through.
 */
module.exports = {
  init: jest.fn(),
  wrap: (component) => component,
  captureException: jest.fn(),
  setUser: jest.fn(),
  addBreadcrumb: jest.fn(),
  ErrorBoundary: ({ children }) => children,
};
