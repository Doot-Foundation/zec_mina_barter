import { Mina, fetchAccount } from 'o1js';
import { config } from './config.js';
import { logger } from './logger.js';
import { createContractInstance, loadContracts } from './contract-imports.js';

/**
 * Settlement Worker
 *
 * Monitors pending OffchainState actions and triggers settlement proofs
 * when threshold is reached. Settlement proofs take ~5-6 minutes to generate.
 *
 * Note: Settlement can be called by anyone, not just the operator.
 * This worker automates the process for convenience.
 */
export class SettlementWorker {
  private isRunning = false;
  private intervalMs: number;
  private minActionsThreshold = 1; // Trigger on any pending action

  constructor(intervalMs: number = 60000) {
    // Default: check every 60 seconds
    this.intervalMs = intervalMs;
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
    logger.info(`Settlement worker started (interval: ${this.intervalMs}ms)`);

    // Run initial check
    await this.checkAndSettle();

    // Start periodic checking
    const intervalId = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(intervalId);
        return;
      }

      await this.checkAndSettle();
    }, this.intervalMs);
  }

  /**
   * Stop settlement worker
   */
  stop() {
    this.isRunning = false;
    logger.info('Settlement worker stopped');
  }

  /**
   * Check pending actions and trigger settlement if needed
   */
  private async checkAndSettle() {
    try {
      logger.debug('Checking for pending OffchainState actions...');

      // Fetch account state
      await fetchAccount({ publicKey: config.mina.poolAddress });

      // Get contract modules
      const modules = await loadContracts();

      // Create contract instance
      const zkApp = await createContractInstance(config.mina.poolAddress);

      // Query settlement status
      // Note: This is a simplified check. In production, you would:
      // 1. Query the action state from GraphQL
      // 2. Count pending actions since last settlement
      // 3. Trigger settlement when threshold reached

      // For now, we'll attempt settlement periodically
      // The actual settlement will only succeed if there are actions to settle

      const pendingActionsCount = await this.getPendingActionsCount();

      if (pendingActionsCount >= this.minActionsThreshold) {
        logger.info(
          `Found ${pendingActionsCount} pending actions, triggering settlement...`
        );

        await this.triggerSettlement(zkApp, modules);
      } else {
        logger.debug(
          `Pending actions: ${pendingActionsCount} (threshold: ${this.minActionsThreshold})`
        );
      }
    } catch (error) {
      logger.error(`Settlement check failed: ${error}`);
    }
  }

  /**
   * Get count of pending actions since last settlement
   */
  private async getPendingActionsCount(): Promise<number> {
    try {
      // Step 1: Fetch fresh account state FIRST
      const account = await fetchAccount({
        publicKey: config.mina.poolAddress
      });

      if (!account.account) {
        logger.warn('Account not found on-chain');
        return 0;
      }

      // Step 2: Create zkApp instance AFTER fetch (uses fresh state)
      const zkApp = await createContractInstance(config.mina.poolAddress);

      // Step 3: Get fresh commitments from fetched state
      const commitments = zkApp.offchainStateCommitments.get();

      // Step 4: Fetch actions since last settlement
      const actions = await Mina.fetchActions(
        config.mina.poolAddress,
        { fromActionState: commitments.actionState }
      );

      if ('error' in actions) {
        logger.warn(`Fetch actions error: ${actions.error.statusText}`);
        return 0;
      }

      // Step 5: Count all actions across blocks/accounts
      const count = actions.reduce((blockSum, block) => {
        const blockCount = block.actions.reduce(
          (acctSum, acct) => acctSum + acct.length,
          0
        );
        return blockSum + blockCount;
      }, 0);

      logger.debug(
        `Pending actions: ${count} (from actionState: ${commitments.actionState})`
      );

      return count;
    } catch (error) {
      logger.error(`getPendingActionsCount failed: ${error}`);
      return 0;
    }
  }

  /**
   * Trigger settlement proof generation and submission
   */
  private async triggerSettlement(zkApp: any, modules: any) {
    try {
      logger.info('Generating settlement proof (this takes ~5-6 minutes)...');
      const startTime = Date.now();

      // Create settlement proof
      // Note: This is a compute-intensive operation
      const proof = await modules.offchainState.createSettlementProof();

      const proofDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`✓ Settlement proof generated in ${proofDuration}s`);

      // Submit proof to contract
      logger.info('Submitting settlement proof...');

      // Fetch latest state
      await fetchAccount({ publicKey: config.mina.poolAddress });
      await fetchAccount({ publicKey: config.operator.publicKey });

      // Create transaction
      const txn = await Mina.transaction(
        { sender: config.operator.publicKey, fee: 0.1e9 },
        async () => {
          await zkApp.settle(proof);
        }
      );

      // Prove and send
      await txn.prove();
      const sentTx = await txn.sign([config.operator.privateKey]).send();

      if (!sentTx || !sentTx.hash) {
        throw new Error('Settlement transaction failed: no hash returned');
      }

      logger.info(`✓ Settlement transaction sent: ${sentTx.hash}`);

      // Wait for confirmation
      await sentTx.wait();

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`✓✓ Settlement complete in ${totalDuration}s`);
    } catch (error) {
      logger.error(`Settlement failed: ${error}`);
    }
  }
}

/**
 * Create and export singleton settlement worker
 * Started from main coordinator
 */
export const settlementWorker = new SettlementWorker();
