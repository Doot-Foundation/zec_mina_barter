import { PublicKey } from 'o1js';
import { config, getEscrowdPort } from './config.js';
import { logger } from './logger.js';
import { minaClient } from './mina-client.js';
import { escrowdClient } from './escrowd-client.js';
import { CombinedTradeState, MinaTrade } from './types.js';
import { fetchKeypairByMina, fetchKeypairByZcash } from './supabase-client.js';
import { getCrossRate } from './oracle-client.js';
import { portManager } from './port-manager.js';

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

  /**
   * Initialize coordinator
   */
  async initialize() {
    logger.info('Initializing coordinator...');

    // Initialize Mina client
    await minaClient.initialize();
    await minaClient.compile();

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
    logger.debug('--- Poll cycle start ---');

    try {
      // 1. Query active MINA trades from OffchainState
      const minaTrades = await minaClient.getActiveTrades();
      logger.debug(`Found ${minaTrades.length} active MINA trades`);
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
      logger.debug(`Pool balance: ${Number(poolBalance) / 1e9} MINA`);

    } catch (error) {
      logger.error(`Poll cycle error: ${error}`);
    }

    logger.debug('--- Poll cycle end ---');
  }

  /**
   * Process a single trade - check both sides and lock if ready
   */
  private async processTrade(minaTrade: MinaTrade) {
    logger.debug(`Processing trade ${minaTrade.tradeId}`);

    try {
      // Check port availability FIRST
      const isPortAvailable = await portManager.isPortAvailable(minaTrade.tradeId);

      if (!isPortAvailable) {
        const port = getEscrowdPort(minaTrade.tradeId);
        portManager.logCollision(minaTrade.tradeId, port);
        return; // Skip this trade, retry in next poll cycle
      }

      // Get combined state from both chains
      const state = await this.getCombinedState(minaTrade.tradeId);

      if (!state.minaState) {
        logger.debug(`  No MINA state for ${minaTrade.tradeId}`);
        return;
      }

      if (!state.zecState) {
        logger.debug(`  No ZEC state for ${minaTrade.tradeId}`);
        return;
      }

      // Check if ready to lock
      if (state.readyToLock) {
        logger.info(`✓ Trade ${minaTrade.tradeId} ready to lock (both sides funded)`);
        await this.lockBothSides(state, minaTrade);
      } else {
        logger.debug(
          `  Trade ${minaTrade.tradeId} not ready (MINA locked=${state.minaState.inTransit}, ZEC verified=${state.zecState.verified}, ZEC locked=${state.zecState.in_transit})`
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

    logger.info(`Locking trade ${state.tradeId} on both chains...`);

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

      // Step 1: Lock MINA side
      const minaTxHash = await minaClient.lockTrade(state.tradeId, claimantPk);

      if (!minaTxHash) {
        throw new Error('Failed to lock MINA side');
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
          `ZEC lock failed for ${state.tradeId}. Attempt ${attempts}/5, retrying after 60s`
        );
        if (attempts >= 5) {
          logger.warn(`Max retries reached for ${state.tradeId}, triggering emergency unlock`);
          await minaClient.emergencyUnlock(state.tradeId);
          this.lockRetryState.delete(state.tradeId);
        }
        return;
      }

      logger.info(`✓✓ Trade ${state.tradeId} locked on both chains`);
      this.lockRetryState.delete(state.tradeId);
      this.lockedTrades.set(state.tradeId, minaTrade);

    } catch (error) {
      logger.error(`Failed to lock trade ${state.tradeId}: ${error}`);
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
      return;
    }

    if (!zecState.in_transit) {
      // already sent or unlocked
      this.lockedTrades.delete(tradeId);
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
