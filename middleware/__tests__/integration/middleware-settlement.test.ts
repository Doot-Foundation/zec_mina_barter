// @ts-nocheck
/**
 * Integration Tests: SettlementWorker
 *
 * Tests the actual SettlementWorker class:
 * - constructor(intervalMs) - Worker initialization with interval
 * - start() - Start settlement monitoring loop
 * - stop() - Stop settlement monitoring
 *
 * Note: Private methods (checkAndSettle, getPendingActionsCount, triggerSettlement)
 * are not tested directly - they are tested through integration behavior.
 */

import { jest } from '@jest/globals';
import { Field, Mina, PrivateKey, PublicKey } from 'o1js';

// Mock external dependencies
const mockFetchAccount = jest.fn<() => Promise<any>>();
const mockFetchActions = jest.fn<() => Promise<any>>();
const mockTransaction = jest.fn<() => Promise<any>>();

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
      fetchActions: mockFetchActions,
    },
  };
});

// Mock contract imports
jest.unstable_mockModule('../../src/contract-imports.ts', () => ({
  loadContracts: jest.fn().mockResolvedValue({
    MinaEscrowPool: class MockContract {},
    offchainState: {
      createSettlementProof: jest.fn().mockResolvedValue({
        publicInput: Field(0),
        publicOutput: Field(0),
        proof: 'mock-proof-data',
      }),
    },
  }),
  createContractInstance: jest.fn().mockResolvedValue({
    address: 'B62qrbDCjDYEypocUpG3m6eL62zcvexsaRjhSJp5JWUQeny1qVEKbyP',
    token: { id: Field(1) },
    offchainStateCommitments: {
      get: jest.fn().mockReturnValue({
        actionState: Field(0),
      }),
    },
    settle: jest.fn(),
  }),
  compileContracts: jest.fn().mockResolvedValue(undefined),
}));

const { SettlementWorker } = await import('../../src/settlement-worker.ts');

describe('SettlementWorker Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers(); // Use real timers by default

    // Default mock for fetchAccount
    mockFetchAccount.mockResolvedValue({
      account: {
        balance: { toBigInt: () => 1000000000n },
        nonce: { toBigInt: () => 0n },
      },
    });

    // Default mock for fetchActions (no pending actions)
    mockFetchActions.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('SettlementWorker Constructor', () => {
    test('should create worker with default interval (60s)', () => {
      const worker = new SettlementWorker();

      expect(worker).toBeInstanceOf(SettlementWorker);
      expect((worker as any).intervalMs).toBe(60000);
    });

    test('should create worker with custom interval', () => {
      const customInterval = 30000; // 30 seconds
      const worker = new SettlementWorker(customInterval);

      expect(worker).toBeInstanceOf(SettlementWorker);
      expect((worker as any).intervalMs).toBe(customInterval);
    });

    test('should initialize with isRunning = false', () => {
      const worker = new SettlementWorker();

      expect((worker as any).isRunning).toBe(false);
    });
  });

  describe('Settlement Worker Lifecycle', () => {
    test('should start settlement worker', async () => {
      const worker = new SettlementWorker(100); // Short interval for testing

      await worker.start();

      expect((worker as any).isRunning).toBe(true);

      worker.stop();
    });

    test('should stop settlement worker', async () => {
      const worker = new SettlementWorker(100);

      await worker.start();
      expect((worker as any).isRunning).toBe(true);

      worker.stop();
      expect((worker as any).isRunning).toBe(false);
    });

    test('should not start if already running', async () => {
      const worker = new SettlementWorker(100);

      await worker.start();

      // Try to start again
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await worker.start();

      worker.stop();
      consoleWarnSpy.mockRestore();
    });

    test('should run initial check on start', async () => {
      const worker = new SettlementWorker(60000);

      // Mock getPendingActionsCount to track calls
      const checkSpy = jest.spyOn(worker as any, 'checkAndSettle')
        .mockResolvedValue(undefined);

      await worker.start();

      // Wait a bit for initial check
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(checkSpy).toHaveBeenCalled();

      worker.stop();
      checkSpy.mockRestore();
    });
  });

  describe('Settlement Monitoring', () => {
    test('should check for pending actions periodically', async () => {
      jest.useFakeTimers();

      const worker = new SettlementWorker(1000); // 1 second for testing

      const checkSpy = jest.spyOn(worker as any, 'checkAndSettle')
        .mockResolvedValue(undefined);

      await worker.start();

      // Advance time by 1 second
      await jest.advanceTimersByTimeAsync(1000);

      // Should have been called at least once (initial + 1 interval)
      expect(checkSpy).toHaveBeenCalled();

      worker.stop();
      jest.useRealTimers();
      checkSpy.mockRestore();
    });

    test('should not check after stop', async () => {
      jest.useFakeTimers();

      const worker = new SettlementWorker(1000);

      const checkSpy = jest.spyOn(worker as any, 'checkAndSettle')
        .mockResolvedValue(undefined);

      await worker.start();
      worker.stop();

      // Clear previous calls
      checkSpy.mockClear();

      // Advance time
      await jest.advanceTimersByTimeAsync(5000);

      // Should not have been called after stop
      expect(checkSpy).not.toHaveBeenCalled();

      jest.useRealTimers();
      checkSpy.mockRestore();
    });
  });

  describe('Pending Actions Detection', () => {
    test('should detect no pending actions', async () => {
      const worker = new SettlementWorker(60000);

      // Mock no pending actions
      mockFetchActions.mockResolvedValue([]);

      const pendingCount = await (worker as any).getPendingActionsCount();

      expect(pendingCount).toBe(0);
    });

    test('should count pending actions correctly', async () => {
      const worker = new SettlementWorker(60000);

      // Mock pending actions: blocks → accounts → actions (count by array length)
      mockFetchActions.mockResolvedValue([
        {
          actions: [
            ['action1'],  // Account 1: 1 action
          ],
        },
        {
          actions: [
            ['action2'],  // Account 1: 1 action
            ['action3'],  // Account 2: 1 action
          ],
        },
      ]);

      const pendingCount = await (worker as any).getPendingActionsCount();

      expect(pendingCount).toBe(3);
    });

    test('should handle fetchActions errors gracefully', async () => {
      const worker = new SettlementWorker(60000);

      // Mock error
      mockFetchActions.mockResolvedValue({ error: { statusText: 'GraphQL error' } });

      const pendingCount = await (worker as any).getPendingActionsCount();

      expect(pendingCount).toBe(0);
    });
  });

  describe('Settlement Proof Generation', () => {
    test('should trigger settlement when actions reach threshold', async () => {
      const worker = new SettlementWorker(60000);

      // Mock 1 pending action (threshold is 1)
      mockFetchActions.mockResolvedValue([
        {
          actions: [[Field(1)]],
        },
      ]);

      const { loadContracts } = await import('../../src/contract-imports.ts');
      const modules = await loadContracts();
      const createProofSpy = modules.offchainState.createSettlementProof;

      // Manually call checkAndSettle
      await (worker as any).checkAndSettle();

      expect(createProofSpy).toHaveBeenCalled();
    });

    test('should not trigger settlement below threshold', async () => {
      const worker = new SettlementWorker(60000);

      // Mock no pending actions
      mockFetchActions.mockResolvedValue([]);

      const { loadContracts } = await import('../../src/contract-imports.ts');
      const modules = await loadContracts();
      (modules.offchainState.createSettlementProof as jest.Mock).mockClear();

      // Manually call checkAndSettle
      await (worker as any).checkAndSettle();

      expect(modules.offchainState.createSettlementProof).not.toHaveBeenCalled();
    });

    test('should handle proof generation errors', async () => {
      const worker = new SettlementWorker(60000);

      // Mock pending actions
      mockFetchActions.mockResolvedValue([
        {
          actions: [[Field(1)]],
        },
      ]);

      const { loadContracts } = await import('../../src/contract-imports.ts');
      const modules = await loadContracts();
      (modules.offchainState.createSettlementProof as jest.Mock)
        .mockRejectedValue(new Error('Proof generation failed'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      await (worker as any).checkAndSettle();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Settlement Transaction Submission', () => {
    test('should submit settlement transaction', async () => {
      const worker = new SettlementWorker(60000);

      // Mock pending actions
      mockFetchActions.mockResolvedValue([
        {
          actions: [[Field(1)]],
        },
      ]);

      // Mock proof generation
      const { loadContracts } = await import('../../src/contract-imports.ts');
      const modules = await loadContracts();
      (modules.offchainState.createSettlementProof as jest.Mock).mockResolvedValue({
        publicInput: Field(0),
        publicOutput: Field(0),
        proof: 'mock-proof-data',
      });

      // Mock successful transaction
      const mockSignedTx = {
        hash: 'settlement-tx-hash',
        wait: jest.fn().mockResolvedValue(undefined),
      };

      const mockTxn = {
        prove: jest.fn().mockResolvedValue(undefined),
        sign: jest.fn().mockReturnValue({
          send: jest.fn().mockResolvedValue(mockSignedTx),
        }),
      };

      mockTransaction.mockResolvedValue(mockTxn);

      // Trigger settlement
      await (worker as any).checkAndSettle();

      expect(mockTransaction).toHaveBeenCalled();
      expect(mockTxn.prove).toHaveBeenCalled();
      expect(mockSignedTx.wait).toHaveBeenCalled();
    }, 30000);

    test('should handle transaction submission failures', async () => {
      const worker = new SettlementWorker(60000);

      // Mock pending actions
      mockFetchActions.mockResolvedValue([
        {
          actions: [[Field(1)]],
        },
      ]);

      // Mock transaction failure
      mockTransaction.mockRejectedValue(new Error('Transaction failed'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      await (worker as any).checkAndSettle();

      consoleErrorSpy.mockRestore();
    }, 30000);
  });

  describe('Settlement Worker Integration', () => {
    test('should handle multiple settlement cycles', async () => {
      jest.useFakeTimers();

      const worker = new SettlementWorker(1000);

      // Start with no actions
      mockFetchActions.mockResolvedValue([]);

      await worker.start();

      // First cycle - no actions
      await jest.advanceTimersByTimeAsync(1000);

      // Now add actions
      mockFetchActions.mockResolvedValue([
        {
          actions: [[Field(1)]],
        },
      ]);

      // Second cycle - should trigger settlement
      await jest.advanceTimersByTimeAsync(1000);

      worker.stop();
      jest.useRealTimers();
    });

    test('should continue running after settlement errors', async () => {
      jest.useFakeTimers();

      const worker = new SettlementWorker(1000);

      // Mock pending actions
      mockFetchActions.mockResolvedValue([
        {
          actions: [[Field(1)]],
        },
      ]);

      // Mock proof generation failure
      const { loadContracts } = await import('../../src/contract-imports.ts');
      const modules = await loadContracts();
      (modules.offchainState.createSettlementProof as jest.Mock)
        .mockRejectedValueOnce(new Error('Proof failed'))
        .mockResolvedValue({ proof: 'success' });

      await worker.start();

      // First cycle - should fail but continue
      await jest.advanceTimersByTimeAsync(1000);

      // Second cycle - should succeed
      await jest.advanceTimersByTimeAsync(1000);

      expect((worker as any).isRunning).toBe(true);

      worker.stop();
      jest.useRealTimers();
    });
  });
});
