import { config } from './config.js';
import { logger } from './logger.js';
import { minaClient } from './mina-client.js';
import { getContractModules } from './contract-loader.js';

/**
 * Settlement Worker
 *
 * Dedicated service for OffchainState settlement proof generation and submission.
 * Runs independently from middleware to avoid blocking API/coordinator.
 *
 * Architecture:
 * - Monitors pending OffchainState actions
 * - Generates settlement proofs when threshold reached (~5-6 minutes)
 * - Submits proofs to MinaEscrowPool contract
 * - CPU-intensive, runs in isolated process
 */
export class SettlementWorker {
  private isRunning = false;
  private intervalMs: number;
  private minActionsThreshold: number;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    intervalMs: number = config.settlement.intervalMs,
    minActionsThreshold: number = config.settlement.minActionsThreshold
  ) {
    this.intervalMs = intervalMs;
    this.minActionsThreshold = minActionsThreshold;
  }

  /**
   * Start settlement monitoring loop
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Settlement worker already running');
      return;
    }

    this.isRunning = true;
    logger.info(
      `Settlement worker started (interval: ${this.intervalMs}ms, threshold: ${this.minActionsThreshold} actions)`
    );

    // Run initial check
    await this.checkAndSettle();

    // Start periodic checking
    this.intervalId = setInterval(async () => {
      if (!this.isRunning) {
        if (this.intervalId) {
          clearInterval(this.intervalId);
        }
        return;
      }

      await this.checkAndSettle();
    }, this.intervalMs);
  }

  /**
   * Stop settlement worker
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    logger.info('Settlement worker stopped');
  }

  /**
   * Check pending actions and trigger settlement if needed
   */
  private async checkAndSettle() {
    try {
      logger.debug('--- Settlement check start ---');

      // Get pending actions count
      const pendingActionsCount = await minaClient.getPendingActionsCount();

      if (pendingActionsCount >= this.minActionsThreshold) {
        logger.info(
          `Found ${pendingActionsCount} pending actions (threshold: ${this.minActionsThreshold})`
        );
        logger.info('Triggering settlement...');

        await this.triggerSettlement();
      } else {
        logger.debug(
          `Pending actions: ${pendingActionsCount} (threshold: ${this.minActionsThreshold}) - skipping settlement`
        );
      }

      logger.debug('--- Settlement check end ---');
    } catch (error) {
      logger.error(`Settlement check failed: ${error}`);
    }
  }

  /**
   * Trigger settlement proof generation and submission
   */
  private async triggerSettlement() {
    try {
      logger.info('=== SETTLEMENT PROOF GENERATION STARTING ===');
      logger.info('This will take approximately 5-6 minutes...');
      logger.info('');

      const startTime = Date.now();

      // Get contract modules
      const modules = getContractModules();

      // Generate settlement proof (CPU-intensive, ~5-6 minutes)
      logger.info('[1/2] Generating settlement proof...');
      const proofStartTime = Date.now();

      const proof = await modules.offchainState.createSettlementProof();

      const proofDuration = ((Date.now() - proofStartTime) / 1000).toFixed(2);
      logger.info(`✓ Settlement proof generated in ${proofDuration}s`);
      logger.info('');

      // Submit proof to contract
      logger.info('[2/2] Submitting settlement proof...');
      const submitStartTime = Date.now();

      const txHash = await minaClient.submitSettlementProof(proof);

      if (!txHash) {
        throw new Error('Failed to submit settlement proof');
      }

      const submitDuration = ((Date.now() - submitStartTime) / 1000).toFixed(2);
      logger.info(`✓ Proof submitted in ${submitDuration}s`);
      logger.info('');

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info('=== SETTLEMENT COMPLETE ===');
      logger.info(`Total time: ${totalDuration}s`);
      logger.info(`Transaction: ${txHash}`);
      logger.info('');
    } catch (error) {
      logger.error(`Settlement failed: ${error}`);
      logger.error('Will retry on next check cycle');
    }
  }
}

/**
 * Create and export singleton settlement worker
 */
export const settlementWorker = new SettlementWorker();
