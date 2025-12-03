import { jest } from '@jest/globals';
import type { Mock } from 'jest-mock';

/**
 * Create a mock MinaClient with all methods
 */
export const createMockMinaClient = () => ({
  initialize: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  compile: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  getActiveTrades: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
  getTrade: jest.fn<(id: string) => Promise<any>>().mockResolvedValue(null),
  lockTrade: jest.fn<(id: string, claimant: any) => Promise<string>>().mockResolvedValue('CkpZNZcSLyDKr45kWnqVXWtmhDVxvZLc4Qh7F2BpYqRH6hSKJq3'),
  emergencyUnlock: jest.fn<(id: string) => Promise<string>>().mockResolvedValue('CkpZNZcSLyDKr45kWnqVXWtmhDVxvZLc4Qh7F2BpYqRH6hSKJq3'),
  getPoolBalance: jest.fn<() => Promise<bigint>>().mockResolvedValue(0n),
  claim: jest.fn<(id: string) => Promise<string>>().mockResolvedValue('CkpZNZcSLyDKr45kWnqVXWtmhDVxvZLc4Qh7F2BpYqRH6hSKJq3'),
  refund: jest.fn<(id: string) => Promise<string>>().mockResolvedValue('CkpZNZcSLyDKr45kWnqVXWtmhDVxvZLc4Qh7F2BpYqRH6hSKJq3'),
});

/**
 * Create a mock Doot oracle client
 */
export const createMockOracleClient = () => ({
  getData: jest.fn<(token: string) => Promise<any>>().mockResolvedValue({
    source: 'API',
    fromAPI: true,
    fromL2: false,
    fromL1: false,
    price_data: {
      token: 'bitcoin',
      price: '1000000000000', // $100,000 with 10 decimals
      decimals: '10',
      aggregationTimestamp: Date.now().toString(),
      signature: 'mock-signature',
      oracle: 'B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z',
    },
    proof_data: '{}',
  }),
  isKeyValid: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
});

/**
 * Create a mock CoinGecko client
 */
export const createMockCoinGeckoClient = () => ({
  getPrice: jest.fn<() => Promise<any>>().mockResolvedValue({
    bitcoin: { usd: 100000 },
    mina: { usd: 1.0 },
  }),
});

/**
 * Create a mock Supabase client
 */
export const createMockSupabaseClient = () => ({
  from: jest.fn<(table: string) => any>().mockReturnThis(),
  select: jest.fn<(columns?: string) => any>().mockReturnThis(),
  insert: jest.fn<(data: any) => any>().mockReturnThis(),
  update: jest.fn<(data: any) => any>().mockReturnThis(),
  delete: jest.fn<() => any>().mockReturnThis(),
  eq: jest.fn<(column: string, value: any) => any>().mockReturnThis(),
  single: jest.fn<() => Promise<any>>().mockResolvedValue({
    data: {
      zec_address: 't1Alice123...',
      mina_address: 'B62qkDepositor...',
      created_at: new Date().toISOString(),
    },
    error: null,
  }),
});

/**
 * Create a mock logger
 */
export const createMockLogger = () => ({
  info: jest.fn<(...args: any[]) => void>(),
  warn: jest.fn<(...args: any[]) => void>(),
  error: jest.fn<(...args: any[]) => void>(),
  debug: jest.fn<(...args: any[]) => void>(),
});

/**
 * Create a mock PortManager
 */
export const createMockPortManager = () => ({
  isPortAvailable: jest.fn<(tradeId: string) => Promise<boolean>>().mockResolvedValue(true),
  logCollision: jest.fn<(tradeId: string, port: number) => void>(),
  getPort: jest.fn<(tradeId: string) => number>().mockReturnValue(15234),
});

/**
 * Create a mock SettlementWorker
 */
export const createMockSettlementWorker = () => ({
  start: jest.fn<() => Promise<void>>(),
  stop: jest.fn<() => void>(),
  checkAndSettle: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  isRunning: jest.fn<() => boolean>().mockReturnValue(false),
});

/**
 * Create a mock child_process.spawn return value
 */
export const createMockSpawnProcess = (overrides: any = {}) => {
  const EventEmitter = require('events');
  const process = new EventEmitter();

  return Object.assign(process, {
    pid: 12345 + Math.floor(Math.random() * 10000),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: jest.fn<(data: any) => void>(), end: jest.fn<() => void>() },
    kill: jest.fn<(signal?: string) => void>(),
    exitCode: null,
    killed: false,
    ...overrides,
  });
};

/**
 * Create a mock HTTP fetch response
 */
export const createMockFetchResponse = (
  body: any,
  options: any = {}
) => ({
  ok: options.ok !== undefined ? options.ok : true,
  status: options.status || 200,
  statusText: options.statusText || 'OK',
  headers: new Map(Object.entries(options.headers || {})),
  json: jest.fn<() => Promise<any>>().mockResolvedValue(body),
  text: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify(body)),
  ...options,
});

/**
 * Create a mock LocalBlockchain instance
 */
export const createMockLocalBlockchain = () => ({
  testAccounts: [
    {
      key: { toBase58: () => 'EKFHtzKvGhST9bDtN1FuHj9gkT8azAmfF4nqcjB3yPJr2UyVvXjq' },
      toBase58: () => 'B62qkoGddv1djrxNY7CAdrNWkkjrU72BKCoAfdKxWUqYV5bWk5kej27',
    },
    {
      key: { toBase58: () => 'EKEo6xfJePfpzqYCsB8BUwENsHbMGK1jFZGmLHKqLQPRwHTEEJH5' },
      toBase58: () => 'B62qkDepositor123...',
    },
    {
      key: { toBase58: () => 'EKFHtzKvGhST9bDtN1FuHj9gkT8azAmfF4nqcjB3yPJr2UyVvXjr' },
      toBase58: () => 'B62qkClaimant123...',
    },
  ],
  getNetworkState: jest.fn<() => any>().mockReturnValue({
    blockchainLength: { toString: () => '100' },
  }),
});

/**
 * Create a mock MinaEscrowPool zkApp instance
 */
export const createMockZkApp = () => ({
  deposit: jest.fn<(...args: any[]) => any>(),
  lockTrade: jest.fn<(...args: any[]) => any>(),
  claim: jest.fn<(...args: any[]) => any>(),
  refund: jest.fn<(...args: any[]) => any>(),
  emergencyUnlock: jest.fn<(...args: any[]) => any>(),
  settle: jest.fn<(...args: any[]) => any>(),
  offchainState: {
    fields: {
      trades: {
        get: jest.fn<() => Promise<any>>().mockResolvedValue({
          isSome: { toBoolean: () => false },
        }),
      },
    },
  },
  owner: { get: jest.fn<() => any>() },
  operator: { get: jest.fn<() => any>() },
});
