import { PublicKey } from 'o1js';
import { config } from './config.js';
import { logger, colors } from './logger.js';
import { minaClient } from './mina-client.js';
import { escrowdClient } from './escrowd-client.js';
import { CombinedTradeState, MinaTrade } from './types.js';
import { fetchKeypairByMina, fetchKeypairByZcash } from './supabase-client.js';
import { getCrossRate } from './oracle-client.js';
import { portManager } from './port-manager.js';
import { portAllocator } from './port-allocator.js';

/**
 * Stateless coordinator for MINA ↔ ZEC atomic swaps
 *
 * Architecture:
 * - No database, no persistent state
 * - Queries both chains every poll interval
 * - Locks both sides when both funded
 * - All state lives on-chain (MINA) or in escrowd instances (ZEC)
 */
export class Coordinator {
  private isRunning = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private lockedTrades = new Map<string, MinaTrade>();
  private lockRetryState = new Map<string, { attempts: number; nextAttempt: number }>();
  // Cache of MINA lock transaction hashes per trade so we never
  // submit multiple lockTrade() txs for the same trade while we
  // are still trying to lock the ZEC side.
  private minaLockTxHashes = new Map<string, string>();
  // Trades currently undergoing a lockBothSides() flow. Prevents
  // concurrent lock attempts for the same tradeId across overlapping
  // poll cycles.
  private lockingTrades = new Set<string>();

  /**
   * Initialize coordinator
   */
  async initialize() {
    logger.info('Initializing coordinator...');

    // Initialize Mina client (network setup only)
    await minaClient.initialize();
    // Note: Compilation happens in main thread before this is called

    // Run clean slate recovery to unlock any stuck trades
    await this.cleanSlate();

    logger.info('✓ Coordinator initialized');
  }

  /**
   * Start monitoring loop
   */
  start() {
    if (this.isRunning) {
      logger.warn('Coordinator already running');
      return;
    }

    this.isRunning = true;
    logger.info(`Starting coordinator (polling every ${config.polling.intervalMs}ms)`);

    // Run immediately
    this.poll().catch((error) => {
      logger.error(`Initial poll failed: ${error}`);
    });

    // Schedule periodic polling
    this.pollInterval = setInterval(() => {
      this.poll().catch((error) => {
        logger.error(`Poll failed: ${error}`);
      });
    }, config.polling.intervalMs);
  }

  /**
   * Stop monitoring loop
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping coordinator...');
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Clear in-memory caches
    this.lockedTrades.clear();
    this.lockRetryState.clear();
    this.minaLockTxHashes.clear();
    this.lockingTrades.clear();

    logger.info('✓ Coordinator stopped');
  }

  /**
   * Clean slate recovery - emergency unlock any stuck MINA locks
   * Called on initialization to handle crash recovery
   */
  private async cleanSlate() {
    logger.info('Running clean slate recovery...');

    try {
      // Get all active MINA trades
      const minaTrades = await minaClient.getActiveTrades();

      for (const trade of minaTrades) {
        // Check if MINA is locked but ZEC is not in-transit
        if (trade.inTransit) {
          const zecState = await escrowdClient.getStatus(trade.tradeId);

          // If ZEC side doesn't exist or is not locked, emergency unlock MINA
          if (!zecState || !zecState.in_transit) {
            logger.warn(
              `Found inconsistent state for ${trade.tradeId}: MINA locked but ZEC not in-transit. Emergency unlocking...`
            );

            await minaClient.emergencyUnlock(trade.tradeId);
            logger.info(`✓ Emergency unlocked ${trade.tradeId}`);
          }
        }
      }

      logger.info('✓ Clean slate recovery complete');
    } catch (error) {
      logger.error(`Clean slate recovery failed: ${error}`);
    }
  }

  /**
   * Main polling logic - queries both chains and locks trades
   */
  private async poll() {
    logger.debug('--- [Coordinator] Poll cycle start ---');

    try {
      // 1. Query active MINA trades from OffchainState
      const minaTrades = await minaClient.getActiveTrades();
      logger.info(
        `[Coordinator] Active MINA trades this cycle: ${minaTrades.length} -> [${minaTrades
          .map((t) => t.tradeId)
          .join(', ')}]`,
      );
      const activeTradeIds = new Set(minaTrades.map((t) => t.tradeId));

      // 2. For each MINA trade, check ZEC side
      for (const minaTrade of minaTrades) {
        await this.processTrade(minaTrade);
      }

      // 3. Check locked trades that disappeared from MINA side (claimed/refunded)
      for (const [tradeId, cached] of this.lockedTrades.entries()) {
        if (activeTradeIds.has(tradeId)) continue;
        await this.handlePostClaim(tradeId, cached);
      }

      // 4. Log pool status
      const poolBalance = await minaClient.getPoolBalance();
      logger.debug(
        `[Coordinator] Pool balance: ${Number(poolBalance) / 1e9} MINA`,
      );

    } catch (error) {
      logger.error(`[Coordinator] Poll cycle error: ${error}`);
    }

    logger.debug('--- [Coordinator] Poll cycle end ---');
  }

  /**
   * Process a single trade - check both sides and lock if ready
   */
  private async processTrade(minaTrade: MinaTrade) {
    logger.info(
      `[Coordinator] Processing trade ${minaTrade.tradeId} (amount=${minaTrade.amount} inTransit=${minaTrade.inTransit})`,
    );

    try {
      // If we've already locked this trade on both chains, don't try again.
      if (this.lockedTrades.has(minaTrade.tradeId)) {
        logger.debug(
          `[Coordinator] Trade ${minaTrade.tradeId} already locked; skipping processTrade`,
        );
        return;
      }

      // If a lockBothSides() call is already in progress for this trade,
      // skip to avoid overlapping lock attempts and nonce conflicts.
      if (this.lockingTrades.has(minaTrade.tradeId)) {
        logger.debug(
          `[Coordinator] Trade ${minaTrade.tradeId} is currently being locked; skipping this cycle`,
        );
        return;
      }
      // If we've already locked this trade on both chains, don't try again.
      if (this.lockedTrades.has(minaTrade.tradeId)) {
        logger.debug(
          `[Coordinator] Trade ${minaTrade.tradeId} already locked; skipping processTrade`,
        );
        return;
      }

      // Check port availability FIRST
      const isPortAvailable = await portManager.isPortAvailable(minaTrade.tradeId);

      if (!isPortAvailable) {
        const port = portAllocator.get(minaTrade.tradeId) || 0;
        portManager.logCollision(minaTrade.tradeId, port);
        logger.info(
          `[Coordinator] Skipping trade ${minaTrade.tradeId} this cycle due to occupied port (mapped port=${port})`,
        );
        return; // Skip this trade, retry in next poll cycle
      }

      // Get combined state from both chains
      const state = await this.getCombinedState(minaTrade.tradeId);

      if (!state.minaState) {
        logger.warn(
          `[Coordinator] No MINA state for ${minaTrade.tradeId} (getTrade returned null)`,
        );
        return;
      }

      if (!state.zecState) {
        logger.warn(
          `[Coordinator] No ZEC state for ${minaTrade.tradeId} (escrowd status unavailable)`,
        );
        return;
      }

      // Check if ready to lock
      if (state.readyToLock) {
        logger.info(
          `${colors.locking}[Coordinator] ✓ Trade ${minaTrade.tradeId} ready to lock (MINA inTransit=${state.minaState.inTransit}, ZEC verified=${state.zecState.verified}, ZEC in_transit=${state.zecState.in_transit})`,
        );
        await this.lockBothSides(state, minaTrade);
      } else {
        logger.info(
          `${colors.locking}[Coordinator] Trade ${minaTrade.tradeId} not ready (MINA inTransit=${state.minaState.inTransit}, ZEC verified=${state.zecState.verified}, ZEC in_transit=${state.zecState.in_transit})`,
        );
      }

    } catch (error) {
      logger.error(`Failed to process trade ${minaTrade.tradeId}: ${error}`);
    }
  }

  /**
   * Get combined state from both chains
   */
  private async getCombinedState(tradeId: string): Promise<CombinedTradeState> {
    // Query MINA side
    const minaState = await minaClient.getTrade(tradeId);

    // Query ZEC side
    const zecState = await escrowdClient.getStatus(tradeId);

    // Determine if ready to lock
    const readyToLock =
      minaState !== null &&
      zecState !== null &&
      !minaState.inTransit &&      // MINA not locked
      zecState.verified &&          // ZEC deposit verified
      !zecState.in_transit;         // ZEC not locked

    logger.info(
      `[Coordinator] Combined state for ${tradeId}: ` +
        `minaState=${minaState ? 'present' : 'null'} ` +
        `zecState=${zecState ? 'present' : 'null'} ` +
        `mina.inTransit=${minaState?.inTransit ?? 'n/a'} ` +
        `zec.verified=${zecState?.verified ?? 'n/a'} ` +
        `zec.in_transit=${zecState?.in_transit ?? 'n/a'} ` +
        `=> readyToLock=${readyToLock}`,
    );

    return {
      tradeId,
      minaState,
      zecState,
      readyToLock,
    };
  }

  /**
   * Lock both sides of the trade atomically
   */
  private async lockBothSides(state: CombinedTradeState, minaTrade: MinaTrade) {
    if (!state.minaState || !state.zecState) {
      logger.error(`Cannot lock trade ${state.tradeId}: missing state`);
      return;
    }

    // Guard against concurrent lock attempts for the same tradeId.
    if (this.lockingTrades.has(state.tradeId)) {
      logger.debug(
        `[Coordinator] lockBothSides called while lock already in progress for ${state.tradeId}; skipping`,
      );
      return;
    }
    this.lockingTrades.add(state.tradeId);

    logger.info(`${colors.locking}Locking trade ${state.tradeId} on both chains...`);

    try {
      // Oracle pricing (USD) to derive cross-rate
      const oracle = await getCrossRate();
      const slippageBps = config.oracle.slippageBps;

      // Resolve claimant (ZEC seller MINA address) from origin address via Supabase
      const originAddr = state.zecState.origin_address;
      let claimantPk: PublicKey | null = null;
      if (originAddr) {
        const keypair = await fetchKeypairByZcash(originAddr);
        if (keypair?.minaPublicKey) {
          claimantPk = PublicKey.fromBase58(keypair.minaPublicKey);
        }
      }

      if (!claimantPk) {
        logger.warn(
          `Could not resolve claimant Mina address from origin ${originAddr ?? 'unknown'}; using depositor as fallback`
        );
        claimantPk = PublicKey.fromBase58(state.minaState.depositor);
      }

      // Step 1: Lock MINA side (at most once per tradeId)
      let minaTxHash = this.minaLockTxHashes.get(state.tradeId) ?? null;
      if (!minaTxHash) {
        minaTxHash = await minaClient.lockTrade(state.tradeId, claimantPk);
        if (!minaTxHash) {
          throw new Error('Failed to lock MINA side');
        }
        this.minaLockTxHashes.set(state.tradeId, minaTxHash);

        // FIX: Immediately mark as locked to prevent duplicate MINA lock attempts
        // This must be set here, not after ZEC lock, to prevent re-entry if ZEC fails
        this.lockedTrades.set(state.tradeId, minaTrade);
        logger.info(`${colors.locking}[Coordinator] ✓ MINA locked, trade ${state.tradeId} marked as locked (tx: ${minaTxHash})`);
      } else {
        logger.debug(
          `[Coordinator] Re-using cached MINA lock tx for ${state.tradeId}: ${minaTxHash}`,
        );
      }

      // Step 2: Lock ZEC side
      // Expected MINA amount is known from trade data
      const expectedMinaAmount = state.minaState.amount;

      // Compute expected ZEC for logging (scaled) and apply slippage guard against zero
      const priceZecPerMina = oracle.priceZecPerMina; // scaled by decimals
      const expectedZecScaled =
        (BigInt(state.minaState.amount) * priceZecPerMina) / oracle.decimals;
      if (expectedZecScaled <= 0n) {
        throw new Error('Oracle produced non-positive expected ZEC');
      }

      const retry = this.lockRetryState.get(state.tradeId) ?? {
        attempts: 0,
        nextAttempt: 0,
      };
      const now = Date.now();
      if (retry.nextAttempt && now < retry.nextAttempt) {
        logger.debug(`Skipping ZEC lock retry for ${state.tradeId} until ${new Date(retry.nextAttempt).toISOString()}`);
        return;
      }

      logger.info(`${colors.locking}[Coordinator] Attempting ZEC lock for ${state.tradeId} (MINA already locked with tx: ${minaTxHash})`);
      const zecLocked = await escrowdClient.setInTransit(
        state.tradeId,
        minaTxHash,
        expectedMinaAmount,
        {
          mina_usd: oracle.mina.price,
          zec_usd: oracle.zec.price,
          decimals: Number(oracle.decimals),
          aggregationTimestamp: oracle.mina.aggregationTimestamp,
        }
      );

      if (!zecLocked) {
        const attempts = retry.attempts + 1;
        const nextAttempt = now + 60_000;
        this.lockRetryState.set(state.tradeId, { attempts, nextAttempt });
        logger.warn(
          `ZEC lock failed for ${state.tradeId}. Attempt ${attempts}/5, retrying after 60s. ` +
          `MINA tx: ${minaTxHash}, lockedTrades size: ${this.lockedTrades.size}`
        );
        if (attempts >= 5) {
          logger.warn(`Max retries reached for ${state.tradeId}, triggering emergency unlock`);
          await minaClient.emergencyUnlock(state.tradeId);
          this.lockRetryState.delete(state.tradeId);
          this.minaLockTxHashes.delete(state.tradeId);
          this.lockedTrades.delete(state.tradeId);  // Also clear lockedTrades on emergency unlock
        }
        return;
      }

      logger.info(`${colors.locking}✓✓ Trade ${state.tradeId} locked on both chains (MINA: ${minaTxHash}, ZEC: locked)`);
      this.lockRetryState.delete(state.tradeId);
      // Keep minaLockTxHashes entry for the lifetime of the trade so we never
      // submit a second lockTrade() tx for this tradeId. It will be cleared
      // when the trade is claimed / refunded or on emergency unlock.
      // Note: lockedTrades already set after MINA lock success above

    } catch (error) {
      logger.error(`${colors.locking}Failed to lock trade ${state.tradeId}: ${error}`);
    } finally {
      // Always clear the in-progress flag so future attempts can proceed
      // if needed (e.g. after an emergency unlock).
      this.lockingTrades.delete(state.tradeId);
    }
  }

  /**
   * After a trade disappears from MINA but escrowd is still in-transit,
   * assume claim succeeded and sweep ZEC to the MINA depositor's ZEC address.
   */
  private async handlePostClaim(tradeId: string, cached: MinaTrade) {
    const zecState = await escrowdClient.getStatus(tradeId);
    if (!zecState) {
      logger.warn(`Escrowd unavailable for ${tradeId}; cleaning cached lock state`);
      this.lockedTrades.delete(tradeId);
      this.minaLockTxHashes.delete(tradeId);
      return;
    }

    if (!zecState.in_transit) {
      // already sent or unlocked
      this.lockedTrades.delete(tradeId);
      this.minaLockTxHashes.delete(tradeId);
      return;
    }

    const keypair = await fetchKeypairByMina(cached.depositor);
    if (!keypair?.zcashPublicKey) {
      logger.error(`Missing ZEC address for depositor ${cached.depositor}; cannot send target`);
      return;
    }

    const sent = await escrowdClient.sendToTarget(tradeId, keypair.zcashPublicKey);
    if (sent) {
      logger.info(`ZEC sent to ${keypair.zcashPublicKey} for trade ${tradeId}`);
      this.lockedTrades.delete(tradeId);
    }
  }
}

export const coordinator = new Coordinator();
