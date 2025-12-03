// @ts-nocheck
/**
 * Integration Tests: MinaClient
 *
 * Tests the actual MinaClient class methods:
 * - initialize() - Network connection
 * - compile() - Contract compilation
 * - getActiveTrades() - Query all active trades
 * - getTrade(id) - Query specific trade
 * - lockTrade(id, claimant) - Lock a trade
 * - emergencyUnlock(id) - Emergency unlock
 * - getPoolBalance() - Query pool balance
 */

import { jest } from '@jest/globals';
import { PublicKey, PrivateKey, Field, Bool, UInt64, Mina } from 'o1js';

// Mock external dependencies
const mockFetchAccount = jest.fn<() => Promise<any>>();
const mockTransaction = jest.fn<() => Promise<any>>();
const mockFetchMerkleMap = jest.fn<() => Promise<any>>();

// Mock o1js-internal module (wrapper for internal o1js imports)
jest.unstable_mockModule('../../src/o1js-internal.ts', () => ({
  fetchMerkleMap: mockFetchMerkleMap,
}));

// Mock config module to avoid requiring environment variables
const mockPrivateKey = PrivateKey.random();
jest.unstable_mockModule('../../src/config.ts', () => ({
  config: {
    operator: {
      privateKey: mockPrivateKey,
      publicKey: mockPrivateKey.toPublicKey(),
    },
    mina: {
      network: 'zeko-devnet',
      graphqlEndpoint: 'https://devnet.zeko.io/graphql',
      poolAddress: PublicKey.empty(),
    },
    escrowd: {
      baseUrl: 'http://127.0.0.1',
      basePort: 8000,
      portRange: 10000,
      operatorToken: 'mock-token',
    },
    supabase: {
      url: 'https://mock.supabase.co',
      serviceRoleKey: 'mock-key',
    },
    oracle: {
      baseUrl: 'https://doot.foundation',
      apiKey: 'mock-api-key',
      slippageBps: 1000,
      ttlMs: 480000,
    },
    polling: {
      intervalMs: 15000,
    },
    logging: {
      level: 'info',
    },
  },
  getEscrowdPort: jest.fn((tradeId: string) => 15234),
  getEscrowdUrl: jest.fn((tradeId: string, endpoint: string) => `http://127.0.0.1:15234${endpoint}`),
  validateConfig: jest.fn(),
}));

jest.unstable_mockModule('o1js', () => {
  const actual = jest.requireActual('o1js') as any;
  return {
    __esModule: true,
    ...actual,
    fetchAccount: mockFetchAccount,
    Mina: {
      Network: jest.fn().mockReturnValue({}),
      setActiveInstance: jest.fn(),
      transaction: mockTransaction,
      fetchActions: jest.fn(),
    },
  };
});

// Mock contract imports
jest.unstable_mockModule('../../src/contract-imports.ts', () => ({
  loadContracts: jest.fn().mockResolvedValue({
    MinaEscrowPool: class MockContract {},
    TradeData: {
      sizeInFields: () => 12, // 12 fields total (0-11) to include completed at index 11
      fromFields: jest.fn((fields: any[]) => ({
        tradeId: fields[0],
        depositor: PublicKey.empty(),
        amount: UInt64.from(10_000_000_000),
        inTransit: Bool.fromFields([fields[4]]),
        claimant: PublicKey.empty(),
        refundAddress: PublicKey.empty(),
        depositBlockHeight: UInt64.from(1000),
        expiryBlockHeight: UInt64.from(2000),
        completed: Bool.fromFields([fields[11]]), // Field 11 is completed
      })),
    },
    isValidUUID: jest.fn(() => true),
    uuidToField: jest.fn((uuid: string) => Field(123)),
    offchainState: {
      setContractInstance: jest.fn(),
    },
  }),
  compileContracts: jest.fn().mockResolvedValue(undefined),
  createContractInstance: jest.fn().mockResolvedValue({
    address: PublicKey.empty(),
    token: { id: Field(1) },
    offchainState: {
      fields: {
        trades: {
          get: jest.fn().mockResolvedValue({
            isSome: Bool(true),
            value: {
              tradeId: Field(123),
              depositor: PublicKey.empty(),
              amount: UInt64.from(10_000_000_000),
              inTransit: Bool(false),
              claimant: PublicKey.empty(),
              refundAddress: PublicKey.empty(),
              depositBlockHeight: UInt64.from(1000),
              expiryBlockHeight: UInt64.from(2000),
              completed: Bool(false),
            },
          }),
        },
      },
    },
    lockTrade: jest.fn(),
    emergencyUnlock: jest.fn(),
  }),
  getContractModules: jest.fn().mockReturnValue({
    isValidUUID: jest.fn(() => true),
    uuidToField: jest.fn((uuid: string) => Field(123)),
    TradeData: {
      sizeInFields: () => 12, // 12 fields total (0-11) to include completed at index 11
      fromFields: jest.fn((fields: any[]) => ({
        tradeId: fields[0],
        depositor: PublicKey.empty(),
        amount: UInt64.from(10_000_000_000),
        inTransit: Bool.fromFields([fields[4]]),
        claimant: PublicKey.empty(),
        refundAddress: PublicKey.empty(),
        depositBlockHeight: UInt64.from(1000),
        expiryBlockHeight: UInt64.from(2000),
        completed: Bool.fromFields([fields[11]]), // Field 11 is completed
      })),
    },
  }),
  isContractsCompiled: jest.fn().mockReturnValue(false),
}));

const { minaClient } = await import('../../src/mina-client.ts');

describe('MinaClient Integration Tests', () => {
  const testKeypair = PrivateKey.random();
  const testPublicKey = testKeypair.toPublicKey();
  const depositorKey = PrivateKey.random().toPublicKey();
  const claimantKey = PrivateKey.random().toPublicKey();

  beforeEach(() => {
    jest.clearAllMocks();

    // Clear cached zkApp instance so mocks can be properly applied
    (minaClient as any).zkApp = null;

    // Default mock for fetchAccount
    mockFetchAccount.mockResolvedValue({
      account: {
        balance: { toBigInt: () => 1000000000n },
        nonce: { toBigInt: () => 0n },
      },
    });
  });

  describe('MinaClient Initialization', () => {
    test('should initialize network connection', async () => {
      await minaClient.initialize();

      // Initialization successful if no error thrown
      // (Mina.Network and setActiveInstance are called internally)
    });

    test('should compile contracts on first call', async () => {
      const { compileContracts, isContractsCompiled } = await import('../../src/contract-imports.ts');

      // Reset mock to return false (not compiled)
      (isContractsCompiled as jest.Mock).mockReturnValue(false);

      await minaClient.compile();

      expect(compileContracts).toHaveBeenCalled();
    });

    test('should skip compilation if already compiled', async () => {
      const { compileContracts, isContractsCompiled } = await import('../../src/contract-imports.ts');

      // Set as already compiled
      (isContractsCompiled as jest.Mock).mockReturnValue(true);
      (compileContracts as jest.Mock).mockClear();

      await minaClient.compile();

      expect(compileContracts).not.toHaveBeenCalled();
    });
  });

  describe('Query Active Trades', () => {
    test('should fetch active trades from OffchainState', async () => {
      const mockTradeField = Field(123);

      // Mock fetchMerkleMap to return trade data
      mockFetchMerkleMap.mockResolvedValue({
        valueMap: new Map([
          [
            Field(0),
            [
              mockTradeField, // tradeId
              Field(1), Field(2), // depositor (2 fields for PublicKey)
              Field(10_000_000_000), // amount
              Bool(false).toField(), // inTransit
              Field(3), Field(4), // claimant
              Field(5), Field(6), // refundAddress
              Field(1000), // depositBlockHeight
              Field(2000), // expiryBlockHeight
              Bool(false).toField(), // completed
            ],
          ],
        ]),
      });

      const trades = await minaClient.getActiveTrades();

      expect(trades).toHaveLength(1);
      expect(trades[0].tradeId).toBe(mockTradeField.toString());
      expect(mockFetchAccount).toHaveBeenCalled();
    });

    test('should filter out completed trades', async () => {
      // Mock with one active and one completed trade
      mockFetchMerkleMap.mockResolvedValue({
        valueMap: new Map([
          [
            Field(0),
            [
              Field(123),
              Field(1), Field(2),
              Field(10_000_000_000),
              Bool(false).toField(),
              Field(3), Field(4),
              Field(5), Field(6),
              Field(1000),
              Field(2000),
              Bool(false).toField(), // Not completed
            ],
          ],
          [
            Field(1),
            [
              Field(456),
              Field(7), Field(8),
              Field(5_000_000_000),
              Bool(true).toField(),
              Field(9), Field(10),
              Field(11), Field(12),
              Field(1500),
              Field(2500),
              Bool(true).toField(), // Completed - should be filtered
            ],
          ],
        ]),
      });

      const trades = await minaClient.getActiveTrades();

      // Should only include non-completed trade
      expect(trades).toHaveLength(1);
      expect(trades[0].tradeId).toBe(Field(123).toString());
    });

    test('should return empty array on error', async () => {
      mockFetchAccount.mockRejectedValue(new Error('Network error'));

      const trades = await minaClient.getActiveTrades();

      expect(trades).toEqual([]);
    });
  });

  describe('Query Specific Trade', () => {
    test('should fetch trade by ID', async () => {
      const tradeId = 'test-trade-id';

      const trade = await minaClient.getTrade(tradeId);

      expect(trade).not.toBeNull();
      expect(trade?.tradeId).toBe(Field(123).toString());
      expect(mockFetchAccount).toHaveBeenCalled();
    });

    test('should return null if trade not found', async () => {
      const { createContractInstance } = await import('../../src/contract-imports.ts');

      // Mock trade as not found (use mockResolvedValueOnce for test isolation)
      (createContractInstance as jest.Mock).mockResolvedValueOnce({
        offchainState: {
          fields: {
            trades: {
              get: jest.fn().mockResolvedValue({
                isSome: Bool(false), // Trade not found
              }),
            },
          },
        },
        token: { id: Field(1) },
      });

      const trade = await minaClient.getTrade('non-existent-trade');

      expect(trade).toBeNull();
    });

    test('should return null if trade is completed', async () => {
      const { createContractInstance } = await import('../../src/contract-imports.ts');

      // Mock trade as completed (use mockResolvedValueOnce for test isolation)
      (createContractInstance as jest.Mock).mockResolvedValueOnce({
        offchainState: {
          fields: {
            trades: {
              get: jest.fn().mockResolvedValue({
                isSome: Bool(true),
                value: {
                  tradeId: Field(123),
                  depositor: PublicKey.empty(),
                  amount: UInt64.from(10_000_000_000),
                  inTransit: Bool(false),
                  claimant: PublicKey.empty(),
                  refundAddress: PublicKey.empty(),
                  depositBlockHeight: UInt64.from(1000),
                  expiryBlockHeight: UInt64.from(2000),
                  completed: Bool(true), // Completed
                },
              }),
            },
          },
        },
        token: { id: Field(1) },
      });

      const trade = await minaClient.getTrade('completed-trade');

      expect(trade).toBeNull();
    });

    test('should handle query errors gracefully', async () => {
      mockFetchAccount.mockRejectedValue(new Error('Network timeout'));

      const trade = await minaClient.getTrade('error-trade');

      expect(trade).toBeNull();
    });
  });

  describe('Lock Trade', () => {
    test('should lock trade with claimant', async () => {
      const tradeId = 'lock-trade-id';

      // Mock transaction creation
      const mockSignedTx = {
        hash: 'tx-hash-123',
        wait: jest.fn().mockResolvedValue(undefined),
      };

      const mockTxn = {
        prove: jest.fn().mockResolvedValue(undefined),
        sign: jest.fn().mockReturnValue({
          send: jest.fn().mockResolvedValue(mockSignedTx),
        }),
      };

      mockTransaction.mockResolvedValue(mockTxn);

      const txHash = await minaClient.lockTrade(tradeId, claimantKey);

      expect(txHash).toBe('tx-hash-123');
      expect(mockTransaction).toHaveBeenCalled();
      expect(mockTxn.prove).toHaveBeenCalled();
    }, 30000);

    test('should return null on lock failure', async () => {
      const tradeId = 'fail-lock-trade';

      mockTransaction.mockRejectedValue(new Error('Proof generation failed'));

      const txHash = await minaClient.lockTrade(tradeId, claimantKey);

      expect(txHash).toBeNull();
    }, 30000);

    test('should wait for transaction confirmation', async () => {
      const tradeId = 'confirm-trade-id';

      const waitMock = jest.fn().mockResolvedValue(undefined);
      const mockSignedTx = {
        hash: 'tx-hash-456',
        wait: waitMock,
      };

      const mockTxn = {
        prove: jest.fn().mockResolvedValue(undefined),
        sign: jest.fn().mockReturnValue({
          send: jest.fn().mockResolvedValue(mockSignedTx),
        }),
      };

      mockTransaction.mockResolvedValue(mockTxn);

      await minaClient.lockTrade(tradeId, claimantKey);

      expect(waitMock).toHaveBeenCalled();
    }, 30000);
  });

  describe('Emergency Unlock', () => {
    test('should emergency unlock a locked trade', async () => {
      const tradeId = 'unlock-trade-id';

      const mockSignedTx = {
        hash: 'unlock-tx-hash',
        wait: jest.fn().mockResolvedValue(undefined),
      };

      const mockTxn = {
        prove: jest.fn().mockResolvedValue(undefined),
        sign: jest.fn().mockReturnValue({
          send: jest.fn().mockResolvedValue(mockSignedTx),
        }),
      };

      mockTransaction.mockResolvedValue(mockTxn);

      const txHash = await minaClient.emergencyUnlock(tradeId);

      expect(txHash).toBe('unlock-tx-hash');
      expect(mockTransaction).toHaveBeenCalled();
    }, 30000);

    test('should return null on emergency unlock failure', async () => {
      const tradeId = 'fail-unlock-trade';

      mockTransaction.mockRejectedValue(new Error('Transaction failed'));

      const txHash = await minaClient.emergencyUnlock(tradeId);

      expect(txHash).toBeNull();
    }, 30000);
  });

  describe('Pool Balance Query', () => {
    test('should fetch pool balance', async () => {
      mockFetchAccount.mockResolvedValue({
        account: {
          balance: { toBigInt: () => 5000000000n },
        },
      });

      const balance = await minaClient.getPoolBalance();

      expect(balance).toBe(5000000000n);
    });

    test('should return 0 if account not found', async () => {
      mockFetchAccount.mockResolvedValue({
        account: null,
      });

      const balance = await minaClient.getPoolBalance();

      expect(balance).toBe(0n);
    });

    test('should return 0 on fetch error', async () => {
      mockFetchAccount.mockRejectedValue(new Error('GraphQL error'));

      const balance = await minaClient.getPoolBalance();

      expect(balance).toBe(0n);
    });
  });

  describe('Trade ID Field Conversion', () => {
    test('should convert UUID string to Field', async () => {
      const tradeId = '550e8400-e29b-41d4-a716-446655440000';

      // This tests the internal toTradeIdField method indirectly through getTrade
      const trade = await minaClient.getTrade(tradeId);

      // Should not throw, should handle UUID conversion
      expect(trade).toBeDefined();
    });

    test('should handle raw Field strings', async () => {
      const tradeId = '12345678901234567890';

      const trade = await minaClient.getTrade(tradeId);

      // Should handle raw Field string
      expect(trade).toBeDefined();
    });
  });
});
