import { jest } from '@jest/globals';

/**
 * Global setup for integration tests
 * This file is run before all integration tests
 */

// Suppress verbose o1js compilation logs during tests
process.env.LOG_LEVEL = 'error';

// Global setup
beforeAll(() => {
  // Silence console during tests unless debugging
  if (!process.env.DEBUG_TESTS) {
    global.console = {
      ...console,
      log: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
    };
  }
});

// Global teardown
afterAll(() => {
  // Cleanup any remaining resources
});

// Increase default timeout for all integration tests
jest.setTimeout(120000); // 2 minutes

// Global error handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
