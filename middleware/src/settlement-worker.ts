import { Mina } from "o1js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  getGlobalZkApp,
  getContractModules,
  fetchAccountWithRetry,
} from "./shared-contracts.js";

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
  private isSettling = false; // Lock to prevent concurrent settlements
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
    logger.info("[SettlementWorker] start() called");
    if (this.isRunning) {
      logger.warn("Settlement worker already running");
      return;
    }

    this.isRunning = true;
    logger.info(`Settlement worker started (interval: ${this.intervalMs}ms)`);

    // Run initial check
    logger.info("[SettlementWorker] Running initial checkAndSettle()...");
    await this.checkAndSettle();
    logger.info("[SettlementWorker] Initial check complete");

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
    logger.info("Settlement worker stopped");
  }

  /**
   * Check pending actions and trigger settlement if needed
   */
  private async checkAndSettle() {
    // Check if already settling - prevent concurrent settlements
    if (this.isSettling) {
      logger.info("[checkAndSettle] Skipping - settlement already in progress");
      return;
    }

    try {
      logger.info("[checkAndSettle] START");
      logger.info(
        "[checkAndSettle] Checking for pending OffchainState actions..."
      );

      logger.info("[checkAndSettle] Setting network instance...");
      // Ensure network is set
      const network = Mina.Network({
        mina: config.mina.graphqlEndpoint,
        archive: config.mina.graphqlEndpoint,
      });
      Mina.setActiveInstance(network);
      logger.info("[checkAndSettle] Network instance set");

      logger.info("[checkAndSettle] Fetching account state...");
      // Fetch account state with retry
      await fetchAccountWithRetry({ publicKey: config.mina.poolAddress });
      logger.info("[checkAndSettle] Account state fetched");

      logger.info("[checkAndSettle] Getting global zkApp instance...");
      // Use GLOBAL zkApp instance (compiled in main thread)
      const zkApp = getGlobalZkApp();
      logger.info("[checkAndSettle] Got global zkApp");

      logger.info("[checkAndSettle] Loading contract modules...");
      // Get contract modules
      const modules = getContractModules();
      logger.info("[checkAndSettle] Modules loaded");

      // Query settlement status
      // Note: This is a simplified check. In production, you would:
      // 1. Query the action state from GraphQL
      // 2. Count pending actions since last settlement
      // 3. Trigger settlement when threshold reached

      // For now, we'll attempt settlement periodically
      // The actual settlement will only succeed if there are actions to settle

      logger.info("[checkAndSettle] Calling getPendingActionsCount()...");
      const pendingActionsCount = await this.getPendingActionsCount();
      logger.info(
        `[checkAndSettle] Got pending actions count: ${pendingActionsCount}`
      );

      if (pendingActionsCount >= this.minActionsThreshold) {
        logger.info(
          `Found ${pendingActionsCount} pending actions, triggering settlement...`
        );

        // Set lock before starting settlement
        this.isSettling = true;
        logger.info("[checkAndSettle] Settlement lock acquired");

        try {
          await this.triggerSettlement(zkApp, modules);
        } finally {
          // Always release lock when done (success or failure)
          this.isSettling = false;
          logger.info("[checkAndSettle] Settlement lock released");
        }
      } else {
        logger.info(
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
      logger.info("[1/6] Setting network instance...");
      // Step 0: Ensure network is set
      const network = Mina.Network({
        mina: config.mina.graphqlEndpoint,
        archive: config.mina.graphqlEndpoint,
      });
      Mina.setActiveInstance(network);
      logger.info("[1/6] ✓ Network instance set");

      logger.info("[2/6] Fetching account state...");
      // Step 1: Fetch fresh account state FIRST with retry
      const account = await fetchAccountWithRetry({
        publicKey: config.mina.poolAddress,
      });
      logger.info("[2/6] ✓ Account fetched");

      if (!account.account) {
        logger.warn("Account not found on-chain");
        return 0;
      }

      logger.info("[3/6] Getting global zkApp instance...");
      // Step 2: Use GLOBAL zkApp instance (compiled in main thread)
      const zkApp = getGlobalZkApp();
      logger.info("[3/6] ✓ Got global zkApp");

      logger.info("[4/6] Getting offchain state commitments...");
      // Step 3: Get fresh commitments from fetched state
      const commitments = zkApp.offchainStateCommitments.get();
      logger.info("[4/6] ✓ Commitments retrieved");

      logger.info("[5/6] Fetching actions since last settlement...");
      // Step 4: Fetch actions since last settlement
      const actions = await Mina.fetchActions(config.mina.poolAddress, {
        fromActionState: commitments.actionState,
      });

      if ("error" in actions) {
        logger.warn(`Fetch actions error: ${actions.error.statusText}`);
        return 0;
      }
      logger.info("[5/6] ✓ Actions fetched");

      logger.info("[6/6] Counting actions...");
      // Step 5: Count all actions across blocks/accounts
      const count = actions.reduce((blockSum, block) => {
        const blockCount = block.actions.reduce(
          (acctSum, acct) => acctSum + acct.length,
          0
        );
        return blockSum + blockCount;
      }, 0);

      logger.info(
        `[6/6] ✓ Pending actions: ${count} (from actionState: ${commitments.actionState})`
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
      // Ensure network is set
      const network = Mina.Network({
        mina: config.mina.graphqlEndpoint,
        archive: config.mina.graphqlEndpoint,
      });
      Mina.setActiveInstance(network);

      logger.info("Generating settlement proof (this takes ~5-6 minutes)...");
      const startTime = Date.now();

      // Get global zkApp to create settlement proof
      const zkApp = getGlobalZkApp();

      // Create settlement proof from zkApp's offchainState
      // Note: This is a compute-intensive operation
      // May throw "can't be run outside of a checked computation" but recovers internally
      let proof;
      try {
        proof = await zkApp.offchainState.createSettlementProof();
      } catch (error) {
        logger.warn(`Settlement proof warning (non-fatal): ${error}`);
        proof = await zkApp.offchainState.createSettlementProof();
      }

      const proofDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`✓ Settlement proof generated in ${proofDuration}s`);

      // Submit proof to contract
      logger.info("Submitting settlement proof...");

      // Fetch latest state with retry
      await fetchAccountWithRetry({ publicKey: config.mina.poolAddress });
      await fetchAccountWithRetry({ publicKey: config.operator.publicKey });

      // Create transaction
      const txn = await Mina.transaction(
        { sender: config.operator.publicKey, fee: 1e9 },
        async () => {
          await zkApp.settle(proof);
        }
      );

      // Prove and send
      await txn.prove();
      const sentTx = await txn.sign([config.operator.privateKey]).send();

      if (!sentTx || !sentTx.hash) {
        throw new Error("Settlement transaction failed: no hash returned");
      }

      logger.info(`✓ Settlement transaction sent: ${sentTx.hash}`);

      // Wait for confirmation (Zeko L2 doesn't support .wait() GraphQL queries)
      // Transaction is already sent and will be included in next block (~10-25s)
      try {
        await sentTx.wait({ maxAttempts: 3, interval: 5000 });
      } catch (error) {
        // Zeko doesn't support bestChain query - ignore and trust hash was returned
        logger.warn(`Wait confirmation warning (non-fatal): ${error}`);
      }

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
