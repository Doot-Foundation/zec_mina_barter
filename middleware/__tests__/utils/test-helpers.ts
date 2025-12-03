import { Field, PublicKey, UInt64, Bool } from 'o1js';
import { uuidToField } from '../../src/utils.js';

/**
 * Create a mock trade object for testing
 */
export const createMockTrade = (overrides: any = {}) => ({
  tradeId: uuidToField('550e8400-e29b-41d4-a716-446655440000'),
  depositor: PublicKey.empty(),
  amount: UInt64.from(10_000_000_000), // 10 MINA
  inTransit: Bool(false),
  claimant: PublicKey.empty(),
  refundAddress: PublicKey.empty(),
  depositBlockHeight: Field(0),
  expiryBlockHeight: Field(1000),
  completed: Bool(false),
  ...overrides,
});

/**
 * Wait for a condition to become true with timeout
 */
export const waitForCondition = async (
  condition: () => boolean,
  timeout = 5000,
  pollInterval = 100
): Promise<void> => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Condition timeout after ${timeout}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
};

/**
 * Wait for a specific duration (utility for async tests)
 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generate a random test UUID
 */
export const randomTestUUID = (): string => {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return `550e8400-e29b-41d4-a716-${Array(12)
    .fill(0)
    .map(hex)
    .join('')}`;
};

/**
 * Create a mock escrowd process object
 */
export const createMockProcess = (overrides: any = {}) => ({
  pid: 12345 + Math.floor(Math.random() * 10000),
  stdout: {
    on: jest.fn(),
    pipe: jest.fn(),
  },
  stderr: {
    on: jest.fn(),
    pipe: jest.fn(),
  },
  on: jest.fn(),
  kill: jest.fn(),
  exitCode: null,
  killed: false,
  ...overrides,
});

/**
 * Create a mock JSON-RPC response
 */
export const createJsonRpcResponse = (
  result: any,
  error: any = null,
  id = 1
) => ({
  jsonrpc: '2.0',
  id,
  ...(error ? { error } : { result }),
});

/**
 * Assert that a promise rejects with a specific error message
 */
export const expectReject = async (
  promise: Promise<any>,
  errorMessage: string
): Promise<void> => {
  try {
    await promise;
    throw new Error('Expected promise to reject but it resolved');
  } catch (error: any) {
    expect(error.message).toContain(errorMessage);
  }
};

/**
 * Create a mock Mina transaction object
 */
export const createMockTransaction = (overrides: any = {}) => ({
  prove: jest.fn().mockResolvedValue(undefined),
  sign: jest.fn().mockReturnValue({
    send: jest.fn().mockResolvedValue({
      hash: 'CkpZNZcSLyDKr45kWnqVXWtmhDVxvZLc4Qh7F2BpYqRH6hSKJq3',
      wait: jest.fn().mockResolvedValue(undefined),
    }),
  }),
  ...overrides,
});

/**
 * Suppress console output during tests
 */
export const suppressConsole = () => {
  const originalConsole = { ...console };
  beforeEach(() => {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  });
  afterEach(() => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });
};
