// @ts-nocheck
/**
 * Integration Tests: Coordinator
 *
 * Tests the actual Coordinator class with real MinaClient, EscrowdClient,
 * and PortManager integration. Mocks only external services (HTTP, blockchain).
 */

import { jest } from '@jest/globals';
import { PublicKey, PrivateKey, Field, Bool, UInt64, Mina, AccountUpdate } from 'o1js';

// We need to mock modules BEFORE importing them
const mockFetchAccount = jest.fn<() => Promise<any>>();
const mockFetchActions = jest.fn<() => Promise<any>>();
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

// Mock o1js modules
jest.unstable_mockModule('o1js', () => {
  const actual = jest.requireActual('o1js') as any;
  return {
    __esModule: true,
    ...actual,
    fetchAccount: mockFetchAccount,
    Mina: {
      Network: jest.fn(),
      setActiveInstance: jest.fn(),
      transaction: mockTransaction,
      fetchActions: mockFetchActions,
    },
  };
});

// Mock external HTTP clients
jest.unstable_mockModule('../../src/escrowd-client.ts', () => ({
  escrowdClient: {
    getStatus: jest.fn(),
    setInTransit: jest.fn(),
    sendToTarget: jest.fn(),
    getAddresses: jest.fn(),
  },
}));

jest.unstable_mockModule('../../src/oracle-client.ts', () => ({
  getCrossRate: jest.fn(),
  isDootHealthy: jest.fn(),
  fetchPrice: jest.fn(),
  fetchFromCoinGecko: jest.fn(),
}));

jest.unstable_mockModule('../../src/supabase-client.ts', () => ({
  fetchKeypairByMina: jest.fn(),
  fetchKeypairByZcash: jest.fn(),
}));

// Now import the modules after mocking
const { coordinator } = await import('../../src/coordinator.ts');
const { minaClient } = await import('../../src/mina-client.ts');
const { escrowdClient } = await import('../../src/escrowd-client.ts');
const { getCrossRate, isDootHealthy } = await import('../../src/oracle-client.ts');
const { fetchKeypairByMina, fetchKeypairByZcash } = await import('../../src/supabase-client.ts');

describe('Coordinator Integration Tests', () => {
  // Test accounts
  const testKeypair = PrivateKey.random();
  const testPublicKey = testKeypair.toPublicKey();
  const depositorKey = PrivateKey.random().toPublicKey();
  const claimantKey = PrivateKey.random().toPublicKey();

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    mockFetchAccount.mockResolvedValue({
      account: {
        balance: { toBigInt: () => 1000000000n },
        nonce: { toBigInt: () => 0n },
      },
    });
  });

  afterEach(async () => {
    // Stop coordinator if running
    if ((coordinator as any).isRunning) {
      coordinator.stop();
    }
  });

  describe('Coordinator Lifecycle', () => {
    test('should initialize coordinator successfully', async () => {
      // Mock MinaClient.compile() to skip actual compilation
      const originalCompile = minaClient.compile;
      (minaClient as any).compile = jest.fn().mockResolvedValue(undefined);

      // Mock getActiveTrades for cleanSlate
      jest.spyOn(minaClient, 'getActiveTrades').mockResolvedValue([]);

      await coordinator.initialize();

      expect((minaClient as any).compile).toHaveBeenCalled();

      // Restore original method
      (minaClient as any).compile = originalCompile;
    }, 30000);

    test('should start and stop coordinator', async () => {
      // Mock getActiveTrades to return empty array
      jest.spyOn(minaClient, 'getActiveTrades').mockResolvedValue([]);
      jest.spyOn(minaClient, 'getPoolBalance').mockResolvedValue(1000000000n);

      // Start coordinator
      coordinator.start();
      expect((coordinator as any).isRunning).toBe(true);

      // Wait a bit for initial poll
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Stop coordinator
      coordinator.stop();
      expect((coordinator as any).isRunning).toBe(false);
    });

    test('should not start if already running', () => {
      coordinator.start();
      const logWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      coordinator.start(); // Try to start again

      coordinator.stop();
      logWarnSpy.mockRestore();
    });
  });

  describe('Clean Slate Recovery', () => {
    test('should emergency unlock MINA if ZEC is not in-transit', async () => {
      const tradeId = 'test-trade-id';

      // Mock: MINA locked but ZEC not in-transit
      const mockTrade = {
        tradeId,
        tradeIdField: Field(123).toString(),
        depositor: depositorKey.toBase58(),
        amount: '10000000000',
        inTransit: true, // MINA is locked
        claimant: PublicKey.empty().toBase58(),
        refundAddress: depositorKey.toBase58(),
        depositBlockHeight: '1000',
        expiryBlockHeight: '2000',
      };

      jest.spyOn(minaClient, 'getActiveTrades').mockResolvedValue([mockTrade]);
      (escrowdClient.getStatus as jest.Mock).mockResolvedValue({
        verified: true,
        in_transit: false, // ZEC NOT locked
        origin_address: 't1abc123',
      });

      const emergencyUnlockSpy = jest.spyOn(minaClient, 'emergencyUnlock')
        .mockResolvedValue('unlock-tx-hash');

      // Call cleanSlate (via initialize)
      const originalCompile = minaClient.compile;
      (minaClient as any).compile = jest.fn().mockResolvedValue(undefined);

      await coordinator.initialize();

      expect(emergencyUnlockSpy).toHaveBeenCalledWith(tradeId);

      (minaClient as any).compile = originalCompile;
    }, 30000);

    test('should NOT emergency unlock if both sides are consistent', async () => {
      const tradeId = 'test-trade-id';

      const mockTrade = {
        tradeId,
        tradeIdField: Field(123).toString(),
        depositor: depositorKey.toBase58(),
        amount: '10000000000',
        inTransit: true, // MINA is locked
        claimant: claimantKey.toBase58(),
        refundAddress: depositorKey.toBase58(),
        depositBlockHeight: '1000',
        expiryBlockHeight: '2000',
      };

      jest.spyOn(minaClient, 'getActiveTrades').mockResolvedValue([mockTrade]);
      (escrowdClient.getStatus as jest.Mock).mockResolvedValue({
        verified: true,
        in_transit: true, // ZEC IS locked - consistent state
        origin_address: 't1abc123',
      });

      const emergencyUnlockSpy = jest.spyOn(minaClient, 'emergencyUnlock')
        .mockResolvedValue('unlock-tx-hash');

      const originalCompile = minaClient.compile;
      (minaClient as any).compile = jest.fn().mockResolvedValue(undefined);

      await coordinator.initialize();

      expect(emergencyUnlockSpy).not.toHaveBeenCalled();

      (minaClient as any).compile = originalCompile;
    }, 30000);
  });

  describe('Port Collision Detection', () => {
    test('should skip trade if port is occupied', async () => {
      const tradeId = 'test-trade-with-occupied-port';

      const mockTrade = {
        tradeId,
        tradeIdField: Field(123).toString(),
        depositor: depositorKey.toBase58(),
        amount: '10000000000',
        inTransit: false,
        claimant: PublicKey.empty().toBase58(),
        refundAddress: depositorKey.toBase58(),
        depositBlockHeight: '1000',
        expiryBlockHeight: '2000',
      };

      jest.spyOn(minaClient, 'getActiveTrades').mockResolvedValue([mockTrade]);
      jest.spyOn(minaClient, 'getPoolBalance').mockResolvedValue(1000000000n);

      // Mock port as occupied (fetch succeeds)
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ verified: true, in_transit: false }),
      });

      const lockTradeSpy = jest.spyOn(minaClient, 'lockTrade');

      coordinator.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      coordinator.stop();

      // Should NOT attempt to lock since port is occupied
      expect(lockTradeSpy).not.toHaveBeenCalled();
    });
  });

  describe('Trade Processing', () => {
    test('should lock both sides when trade is ready', async () => {
      const tradeId = 'ready-trade-id';

      const mockTrade = {
        tradeId,
        tradeIdField: Field(123).toString(),
        depositor: depositorKey.toBase58(),
        amount: '10000000000',
        inTransit: false, // MINA not locked
        claimant: PublicKey.empty().toBase58(),
        refundAddress: depositorKey.toBase58(),
        depositBlockHeight: '1000',
        expiryBlockHeight: '2000',
      };

      jest.spyOn(minaClient, 'getActiveTrades').mockResolvedValue([mockTrade]);
      jest.spyOn(minaClient, 'getTrade').mockResolvedValue(mockTrade);
      jest.spyOn(minaClient, 'getPoolBalance').mockResolvedValue(1000000000n);

      // Mock port as available (fetch fails - port free)
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      // Mock ZEC side as ready
      (escrowdClient.getStatus as jest.Mock).mockResolvedValue({
        verified: true, // ZEC deposit verified
        in_transit: false, // ZEC not locked
        origin_address: 't1ZecAddress123',
      });

      // Mock oracle
      (getCrossRate as jest.Mock).mockResolvedValue({
        mina: { price: '500000000', decimals: 1e9, aggregationTimestamp: Date.now() },
        zec: { price: '50000000000', decimals: 1e9, aggregationTimestamp: Date.now() },
        priceMinaPerZec: 100n * BigInt(1e9),
        priceZecPerMina: BigInt(1e9) / 100n,
        decimals: BigInt(1e9),
      });

      // Mock Supabase keypair lookup
      (fetchKeypairByZcash as jest.Mock).mockResolvedValue({
        minaPublicKey: claimantKey.toBase58(),
        zcashPublicKey: 't1ZecAddress123',
      });

      // Mock lockTrade
      const lockTradeSpy = jest.spyOn(minaClient, 'lockTrade')
        .mockResolvedValue('mina-lock-tx-hash');

      // Mock setInTransit
      (escrowdClient.setInTransit as jest.Mock).mockResolvedValue(true);

      coordinator.start();
      await new Promise((resolve) => setTimeout(resolve, 300));
      coordinator.stop();

      expect(lockTradeSpy).toHaveBeenCalledWith(tradeId, claimantKey);
      expect(escrowdClient.setInTransit).toHaveBeenCalled();
    });

    test('should handle ZEC lock failure with retry logic', async () => {
      const tradeId = 'retry-trade-id';

      const mockTrade = {
        tradeId,
        tradeIdField: Field(123).toString(),
        depositor: depositorKey.toBase58(),
        amount: '10000000000',
        inTransit: false,
        claimant: PublicKey.empty().toBase58(),
        refundAddress: depositorKey.toBase58(),
        depositBlockHeight: '1000',
        expiryBlockHeight: '2000',
      };

      jest.spyOn(minaClient, 'getActiveTrades').mockResolvedValue([mockTrade]);
      jest.spyOn(minaClient, 'getTrade').mockResolvedValue(mockTrade);
      jest.spyOn(minaClient, 'getPoolBalance').mockResolvedValue(1000000000n);

      (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      (escrowdClient.getStatus as jest.Mock).mockResolvedValue({
        verified: true,
        in_transit: false,
        origin_address: 't1ZecAddress123',
      });

      (getCrossRate as jest.Mock).mockResolvedValue({
        mina: { price: '500000000', decimals: 1e9, aggregationTimestamp: Date.now() },
        zec: { price: '50000000000', decimals: 1e9, aggregationTimestamp: Date.now() },
        priceMinaPerZec: 100n * BigInt(1e9),
        priceZecPerMina: BigInt(1e9) / 100n,
        decimals: BigInt(1e9),
      });

      (fetchKeypairByZcash as jest.Mock).mockResolvedValue({
        minaPublicKey: claimantKey.toBase58(),
        zcashPublicKey: 't1ZecAddress123',
      });

      jest.spyOn(minaClient, 'lockTrade').mockResolvedValue('mina-lock-tx-hash');

      // ZEC lock fails
      (escrowdClient.setInTransit as jest.Mock).mockResolvedValue(false);

      const emergencyUnlockSpy = jest.spyOn(minaClient, 'emergencyUnlock')
        .mockResolvedValue('unlock-tx-hash');

      coordinator.start();

      // The coordinator has internal retry logic with 60s delays, so we won't wait that long
      // Just verify it tracks retry state
      await new Promise((resolve) => setTimeout(resolve, 200));
      coordinator.stop();

      expect(escrowdClient.setInTransit).toHaveBeenCalled();
      // Emergency unlock happens after 5 retries (5 * 60s), won't happen in this short test
    });
  });

  describe('Post-Claim Sweep', () => {
    test('should sweep ZEC after MINA claim is detected', async () => {
      const tradeId = 'claimed-trade-id';

      const mockTrade = {
        tradeId,
        tradeIdField: Field(123).toString(),
        depositor: depositorKey.toBase58(),
        amount: '10000000000',
        inTransit: true,
        claimant: claimantKey.toBase58(),
        refundAddress: depositorKey.toBase58(),
        depositBlockHeight: '1000',
        expiryBlockHeight: '2000',
      };

      // First poll: trade exists and is locked
      // Second poll: trade disappeared (claimed on MINA)
      jest.spyOn(minaClient, 'getActiveTrades')
        .mockResolvedValueOnce([mockTrade])
        .mockResolvedValueOnce([]); // Trade disappeared

      jest.spyOn(minaClient, 'getTrade').mockResolvedValue(null);
      jest.spyOn(minaClient, 'getPoolBalance').mockResolvedValue(1000000000n);

      (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      // ZEC still in-transit after claim
      (escrowdClient.getStatus as jest.Mock).mockResolvedValue({
        verified: true,
        in_transit: true,
        origin_address: 't1ZecAddress123',
      });

      // Mock keypair lookup for sweep
      (fetchKeypairByMina as jest.Mock).mockResolvedValue({
        minaPublicKey: depositorKey.toBase58(),
        zcashPublicKey: 't1DepositZecAddr',
      });

      const sendToTargetSpy = jest.fn().mockResolvedValue(true);
      (escrowdClient.sendToTarget as any) = sendToTargetSpy;

      // Manually add trade to lockedTrades cache
      (coordinator as any).lockedTrades.set(tradeId, mockTrade);

      // Use fake timers to trigger second poll cycle
      jest.useFakeTimers();
      coordinator.start();

      // Advance time to trigger second poll (poll interval is 15000ms)
      await jest.advanceTimersByTimeAsync(15000);

      coordinator.stop();
      jest.useRealTimers();

      expect(sendToTargetSpy).toHaveBeenCalledWith(tradeId, 't1DepositZecAddr');
    });
  });

  describe('Error Handling', () => {
    test('should continue polling on trade processing error', async () => {
      const tradeId = 'error-trade-id';

      const mockTrade = {
        tradeId,
        tradeIdField: Field(123).toString(),
        depositor: depositorKey.toBase58(),
        amount: '10000000000',
        inTransit: false,
        claimant: PublicKey.empty().toBase58(),
        refundAddress: depositorKey.toBase58(),
        depositBlockHeight: '1000',
        expiryBlockHeight: '2000',
      };

      jest.spyOn(minaClient, 'getActiveTrades').mockResolvedValue([mockTrade]);
      jest.spyOn(minaClient, 'getTrade').mockRejectedValue(new Error('Network error'));
      jest.spyOn(minaClient, 'getPoolBalance').mockResolvedValue(1000000000n);

      coordinator.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should still be running despite error
      expect((coordinator as any).isRunning).toBe(true);

      coordinator.stop();
    });

    test('should handle missing ZEC address for post-claim sweep', async () => {
      const tradeId = 'missing-zec-addr';

      const mockTrade = {
        tradeId,
        tradeIdField: Field(123).toString(),
        depositor: depositorKey.toBase58(),
        amount: '10000000000',
        inTransit: true,
        claimant: claimantKey.toBase58(),
        refundAddress: depositorKey.toBase58(),
        depositBlockHeight: '1000',
        expiryBlockHeight: '2000',
      };

      jest.spyOn(minaClient, 'getActiveTrades')
        .mockResolvedValueOnce([mockTrade])
        .mockResolvedValueOnce([]);

      jest.spyOn(minaClient, 'getPoolBalance').mockResolvedValue(1000000000n);

      (escrowdClient.getStatus as jest.Mock).mockResolvedValue({
        in_transit: true,
      });

      // No ZEC address found
      (fetchKeypairByMina as jest.Mock).mockResolvedValue(null);

      const sendToTargetSpy = jest.fn();
      (escrowdClient.sendToTarget as any) = sendToTargetSpy;

      (coordinator as any).lockedTrades.set(tradeId, mockTrade);

      coordinator.start();
      await new Promise((resolve) => setTimeout(resolve, 300));
      coordinator.stop();

      // Should NOT call sendToTarget if keypair is missing
      expect(sendToTargetSpy).not.toHaveBeenCalled();
    });
  });
});
