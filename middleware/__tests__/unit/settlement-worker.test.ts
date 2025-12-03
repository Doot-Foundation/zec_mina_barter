// @ts-nocheck - Test file with complex mocks
import {
  describe,
  it,
  expect,
  beforeEach,
  jest,
  afterEach,
} from '@jest/globals';
import type { Mock } from 'jest-mock';

// Mock all dependencies before importing
const mockFetchAccount = jest.fn() as any;
const mockFetchActions = jest.fn() as any;
const mockCreateContractInstance = jest.fn() as any;
const mockLoadContracts = jest.fn() as any;
const mockCreateSettlementProof = jest.fn() as any;
const mockTransaction = jest.fn() as any;

// Mock o1js
jest.unstable_mockModule('o1js', () => ({
  Mina: {
    fetchAccount: mockFetchAccount,
    fetchActions: mockFetchActions,
    transaction: mockTransaction,
  },
  fetchAccount: mockFetchAccount,
}));

// Mock contract-imports
jest.unstable_mockModule('../../src/contract-imports.js', () => ({
  createContractInstance: mockCreateContractInstance,
  loadContracts: mockLoadContracts,
}));

// Mock config
jest.unstable_mockModule('../../src/config.js', () => ({
  config: {
    mina: {
      poolAddress: 'B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z',
    },
    operator: {
      publicKey: 'B62qkoGddv1djrxNY7CAdrNWkkjrU72BKCoAfdKxWUqYV5bWk5kej27',
      privateKey: {
        toBase58: () => 'EKFHtzKvGhST9bDtN1FuHj9gkT8azAmfF4nqcjB3yPJr2UyVvXjq',
      },
    },
  },
}));

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.unstable_mockModule('../../src/logger.js', () => ({
  logger: mockLogger,
}));

describe('SettlementWorker', () => {
  let SettlementWorker: any;
  let worker: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Import after mocks are set up
    const module = await import('../../src/settlement-worker.js');
    SettlementWorker = module.SettlementWorker;

    // Reset all mocks
    mockFetchAccount.mockReset();
    mockFetchActions.mockReset();
    mockCreateContractInstance.mockReset();
    mockLoadContracts.mockReset();
    mockCreateSettlementProof.mockReset();
    mockTransaction.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.debug.mockReset();
  });

  afterEach(() => {
    if (worker) {
      worker.stop();
    }
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    it('should create worker with default interval (60000ms)', () => {
      worker = new SettlementWorker();
      expect(worker).toBeDefined();
      expect(worker['intervalMs']).toBe(60000);
      expect(worker['minActionsThreshold']).toBe(1);
      expect(worker['isRunning']).toBe(false);
    });

    it('should create worker with custom interval', () => {
      worker = new SettlementWorker(30000);
      expect(worker['intervalMs']).toBe(30000);
      expect(worker['minActionsThreshold']).toBe(1);
    });
  });

  describe('start()', () => {
    it('should start successfully and run initial check', async () => {
      worker = new SettlementWorker(10000);

      // Mock getPendingActionsCount to return 0
      mockFetchAccount.mockResolvedValue({ account: {} });
      mockCreateContractInstance.mockResolvedValue({
        offchainStateCommitments: {
          get: () => ({ actionState: 'mockActionState' }),
        },
      });
      mockFetchActions.mockResolvedValue([]);

      const startPromise = worker.start();

      // Allow async operations to complete
      await Promise.resolve();

      expect(worker['isRunning']).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Settlement worker started (interval: 10000ms)'
      );
      expect(mockFetchAccount).toHaveBeenCalled();
    });

    it('should prevent double-start (already running)', async () => {
      worker = new SettlementWorker(10000);
      worker['isRunning'] = true;

      await worker.start();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Settlement worker already running'
      );
    });

    it('should set up periodic interval checking', async () => {
      worker = new SettlementWorker(5000);

      mockFetchAccount.mockResolvedValue({ account: {} });
      mockCreateContractInstance.mockResolvedValue({
        offchainStateCommitments: {
          get: () => ({ actionState: 'mockActionState' }),
        },
      });
      mockFetchActions.mockResolvedValue([]);

      await worker.start();

      // Fast-forward time by 5 seconds
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // Should have been called twice: initial + 1 interval
      expect(mockFetchAccount.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should run initial check immediately on start', async () => {
      worker = new SettlementWorker(60000);

      mockFetchAccount.mockResolvedValue({ account: {} });
      mockCreateContractInstance.mockResolvedValue({
        offchainStateCommitments: {
          get: () => ({ actionState: 'mockActionState' }),
        },
      });
      mockFetchActions.mockResolvedValue([]);

      await worker.start();
      await Promise.resolve();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Checking for pending OffchainState actions...'
      );
      expect(mockFetchAccount).toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('should stop running worker', async () => {
      worker = new SettlementWorker();
      worker['isRunning'] = true;

      worker.stop();

      expect(worker['isRunning']).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('Settlement worker stopped');
    });

    it('should prevent interval from running after stop', async () => {
      worker = new SettlementWorker(5000);

      mockFetchAccount.mockResolvedValue({ account: {} });
      mockCreateContractInstance.mockResolvedValue({
        offchainStateCommitments: {
          get: () => ({ actionState: 'mockActionState' }),
        },
      });
      mockFetchActions.mockResolvedValue([]);

      await worker.start();
      worker.stop();

      const callCountBeforeAdvance = mockFetchAccount.mock.calls.length;

      // Advance time - should not trigger more checks
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      expect(mockFetchAccount.mock.calls.length).toBe(callCountBeforeAdvance);
    });
  });

  describe('getPendingActionsCount()', () => {
    beforeEach(() => {
      worker = new SettlementWorker();
    });

    it('should return 0 when account not found', async () => {
      mockFetchAccount.mockResolvedValue({ account: null });

      const count = await worker['getPendingActionsCount']();

      expect(count).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith('Account not found on-chain');
    });

    it('should return 0 on fetch actions error', async () => {
      mockFetchAccount.mockResolvedValue({ account: {} });
      mockCreateContractInstance.mockResolvedValue({
        offchainStateCommitments: {
          get: () => ({ actionState: 'mockActionState' }),
        },
      });
      mockFetchActions.mockResolvedValue({
        error: { statusText: 'Network error' },
      });

      const count = await worker['getPendingActionsCount']();

      expect(count).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Fetch actions error: Network error'
      );
    });

    it('should count actions correctly (single block)', async () => {
      mockFetchAccount.mockResolvedValue({ account: {} });
      mockCreateContractInstance.mockResolvedValue({
        offchainStateCommitments: {
          get: () => ({ actionState: 'mockActionState' }),
        },
      });
      mockFetchActions.mockResolvedValue([
        {
          actions: [
            ['action1', 'action2'], // 2 actions from one account
          ],
        },
      ]);

      const count = await worker['getPendingActionsCount']();

      expect(count).toBe(2);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Pending actions: 2 (from actionState: mockActionState)'
      );
    });

    it('should count actions across multiple blocks', async () => {
      mockFetchAccount.mockResolvedValue({ account: {} });
      mockCreateContractInstance.mockResolvedValue({
        offchainStateCommitments: {
          get: () => ({ actionState: 'mockActionState' }),
        },
      });
      mockFetchActions.mockResolvedValue([
        {
          actions: [
            ['action1', 'action2'], // 2 actions
            ['action3'], // 1 action
          ],
        },
        {
          actions: [
            ['action4', 'action5', 'action6'], // 3 actions
          ],
        },
      ]);

      const count = await worker['getPendingActionsCount']();

      expect(count).toBe(6);
    });

    it('should handle empty actions array', async () => {
      mockFetchAccount.mockResolvedValue({ account: {} });
      mockCreateContractInstance.mockResolvedValue({
        offchainStateCommitments: {
          get: () => ({ actionState: 'mockActionState' }),
        },
      });
      mockFetchActions.mockResolvedValue([]);

      const count = await worker['getPendingActionsCount']();

      expect(count).toBe(0);
    });

    it('should log error and return 0 on exception', async () => {
      mockFetchAccount.mockRejectedValue(new Error('Network failure'));

      const count = await worker['getPendingActionsCount']();

      expect(count).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('getPendingActionsCount failed')
      );
    });
  });

  describe('checkAndSettle()', () => {
    beforeEach(() => {
      worker = new SettlementWorker();
    });

    it('should do nothing when below threshold', async () => {
      mockFetchAccount.mockResolvedValue({ account: {} });
      mockCreateContractInstance.mockResolvedValue({
        offchainStateCommitments: {
          get: () => ({ actionState: 'mockActionState' }),
        },
      });
      mockFetchActions.mockResolvedValue([]);
      mockLoadContracts.mockResolvedValue({
        offchainState: { createSettlementProof: mockCreateSettlementProof },
      });

      await worker['checkAndSettle']();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Pending actions: 0 (threshold: 1)'
      );
      expect(mockCreateSettlementProof).not.toHaveBeenCalled();
    });

    it('should trigger settlement when at threshold', async () => {
      mockFetchAccount.mockResolvedValue({ account: {} });
      mockCreateContractInstance.mockResolvedValue({
        offchainStateCommitments: {
          get: () => ({ actionState: 'mockActionState' }),
        },
        settle: jest.fn(),
      });
      mockFetchActions.mockResolvedValue([
        { actions: [['action1']] }, // 1 action (at threshold)
      ]);
      mockLoadContracts.mockResolvedValue({
        offchainState: { createSettlementProof: mockCreateSettlementProof },
      });
      mockCreateSettlementProof.mockResolvedValue({ proof: 'mockProof' });

      // @ts-ignore - Complex mock structure
      const mockTxn = {
        prove: jest.fn().mockResolvedValue(undefined),
        sign: jest.fn().mockReturnValue({
          send: jest.fn().mockResolvedValue({
            hash: 'mockTxHash',
            wait: jest.fn().mockResolvedValue(undefined),
          }),
        }),
      };
      mockTransaction.mockResolvedValue(mockTxn);

      await worker['checkAndSettle']();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Found 1 pending actions, triggering settlement...'
      );
      expect(mockCreateSettlementProof).toHaveBeenCalled();
    });

    it('should trigger settlement when above threshold', async () => {
      mockFetchAccount.mockResolvedValue({ account: {} });
      mockCreateContractInstance.mockResolvedValue({
        offchainStateCommitments: {
          get: () => ({ actionState: 'mockActionState' }),
        },
        settle: jest.fn(),
      });
      mockFetchActions.mockResolvedValue([
        { actions: [['action1', 'action2', 'action3']] }, // 3 actions
      ]);
      mockLoadContracts.mockResolvedValue({
        offchainState: { createSettlementProof: mockCreateSettlementProof },
      });
      mockCreateSettlementProof.mockResolvedValue({ proof: 'mockProof' });

      // @ts-ignore - Complex mock structure
      const mockTxn = {
        prove: jest.fn().mockResolvedValue(undefined),
        sign: jest.fn().mockReturnValue({
          send: jest.fn().mockResolvedValue({
            hash: 'mockTxHash',
            wait: jest.fn().mockResolvedValue(undefined),
          }),
        }),
      };
      mockTransaction.mockResolvedValue(mockTxn);

      await worker['checkAndSettle']();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Found 3 pending actions, triggering settlement...'
      );
    });

    it('should handle errors gracefully', async () => {
      mockFetchAccount.mockRejectedValue(new Error('Network error'));

      await worker['checkAndSettle']();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Settlement check failed')
      );
    });
  });
});
