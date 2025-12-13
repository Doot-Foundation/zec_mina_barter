import { Mina } from "o1js";
import { config } from "./config.js";
import { logger, colors } from "./logger.js";
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
    logger.info(`${colors.settlement}[SettlementWorker] start() called`);
    if (this.isRunning) {
      logger.warn(`${colors.settlement}Settlement worker already running`);
      return;
    }

    this.isRunning = true;
    logger.info(`${colors.settlement}Settlement worker started (interval: ${this.intervalMs}ms)`);

    // Run initial check
    logger.info(`${colors.settlement}[SettlementWorker] Running initial checkAndSettle()...`);
    await this.checkAndSettle();
    logger.info(`${colors.settlement}[SettlementWorker] Initial check complete`);

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
    logger.info(`${colors.settlement}Settlement worker stopped`);
  }

  /**
   * Check pending actions and trigger settlement if needed
   */
  private async checkAndSettle() {
    // Check if already settling - prevent concurrent settlements
    if (this.isSettling) {
      logger.info(`${colors.settlement}[checkAndSettle] Skipping - settlement already in progress`);
      return;
    }

    try {
      logger.info(`${colors.settlement}[checkAndSettle] START`);
      logger.info(
        `${colors.settlement}[checkAndSettle] Checking for pending OffchainState actions...`
      );

      logger.info(`${colors.settlement}[checkAndSettle] Setting network instance...`);
      // Ensure network is set
      const network = Mina.Network({
        mina: config.mina.graphqlEndpoint,
        archive: config.mina.graphqlEndpoint,
      });
      Mina.setActiveInstance(network);
      logger.info(`${colors.settlement}[checkAndSettle] Network instance set`);

      logger.info(`${colors.settlement}[checkAndSettle] Fetching account state...`);
      // Fetch account state with retry
      await fetchAccountWithRetry({ publicKey: config.mina.poolAddress });
      logger.info(`${colors.settlement}[checkAndSettle] Account state fetched`);

      logger.info(`${colors.settlement}[checkAndSettle] Getting global zkApp instance...`);
      // Use GLOBAL zkApp instance (compiled in main thread)
      const zkApp = getGlobalZkApp();
      logger.info(`${colors.settlement}[checkAndSettle] Got global zkApp`);

      logger.info(`${colors.settlement}[checkAndSettle] Loading contract modules...`);
      // Get contract modules
      const modules = getContractModules();
      logger.info(`${colors.settlement}[checkAndSettle] Modules loaded`);

      // Query settlement status
      // Note: This is a simplified check. In production, you would:
      // 1. Query the action state from GraphQL
      // 2. Count pending actions since last settlement
      // 3. Trigger settlement when threshold reached

      // For now, we'll attempt settlement periodically
      // The actual settlement will only succeed if there are actions to settle

      logger.info(`${colors.settlement}[checkAndSettle] Calling getPendingActionsCount()...`);
      // Double-check isSettling flag before querying (prevents race condition)
      if (this.isSettling) {
        logger.info(`${colors.settlement}[checkAndSettle] Settlement started during account fetch, skipping count check`);
        return;
      }
      const pendingActionsCount = await this.getPendingActionsCount();
      logger.info(
        `${colors.settlement}[checkAndSettle] Got pending actions count: ${pendingActionsCount}`
      );

      if (pendingActionsCount >= this.minActionsThreshold) {
        logger.info(
          `${colors.settlement}Found ${pendingActionsCount} pending actions, triggering settlement...`
        );

        // Set lock before starting settlement
        this.isSettling = true;
        logger.info(`${colors.settlement}[checkAndSettle] Settlement lock acquired`);

        try {
          await this.triggerSettlement(zkApp, modules);
        } finally {
          // Always release lock when done (success or failure)
          this.isSettling = false;
          logger.info(`${colors.settlement}[checkAndSettle] Settlement lock released`);
        }
      } else {
        logger.info(
          `${colors.settlement}Pending actions: ${pendingActionsCount} (threshold: ${this.minActionsThreshold})`
        );
      }
    } catch (error) {
      logger.error(`${colors.settlement}Settlement check failed: ${error}`);
    }
  }

  /**
   * Get count of pending actions since last settlement
   */
  private async getPendingActionsCount(): Promise<number> {
    try {
      logger.info(`${colors.settlement}[1/6] Setting network instance...`);
      // Step 0: Ensure network is set
      const network = Mina.Network({
        mina: config.mina.graphqlEndpoint,
        archive: config.mina.graphqlEndpoint,
      });
      Mina.setActiveInstance(network);
      logger.info(`${colors.settlement}[1/6] ✓ Network instance set`);

      logger.info(`${colors.settlement}[2/6] Fetching account state...`);
      // Step 1: Fetch fresh account state FIRST with retry
      const account = await fetchAccountWithRetry({
        publicKey: config.mina.poolAddress,
      });
      logger.info(`${colors.settlement}[2/6] ✓ Account fetched`);

      if (!account.account) {
        logger.warn(`${colors.settlement}Account not found on-chain`);
        return 0;
      }

      logger.info(`${colors.settlement}[3/6] Getting global zkApp instance...`);
      // Step 2: Use GLOBAL zkApp instance (compiled in main thread)
      const zkApp = getGlobalZkApp();
      logger.info(`${colors.settlement}[3/6] ✓ Got global zkApp`);

      logger.info(`${colors.settlement}[4/6] Getting offchain state commitments...`);
      // Step 3: Get fresh commitments from fetched state
      const commitments = zkApp.offchainStateCommitments.get();
      logger.info(`${colors.settlement}[4/6] ✓ Commitments retrieved`);

      logger.info(`${colors.settlement}[5/6] Fetching actions since last settlement...`);
      // Step 4: Fetch actions since last settlement
      const actions = await Mina.fetchActions(config.mina.poolAddress, {
        fromActionState: commitments.actionState,
      });

      if ("error" in actions) {
        logger.warn(`${colors.settlement}Fetch actions error: ${actions.error.statusText}`);
        return 0;
      }
      logger.info(`${colors.settlement}[5/6] ✓ Actions fetched`);

      logger.info(`${colors.settlement}[6/6] Counting actions...`);
      // Step 5: Count all actions across blocks/accounts
      const count = actions.reduce((blockSum, block) => {
        const blockCount = block.actions.reduce(
          (acctSum, acct) => acctSum + acct.length,
          0
        );
        return blockSum + blockCount;
      }, 0);

      // Note: We intentionally do not log commitments.actionState directly here,
      // to avoid calling toString() on a variable Field in provable context.
      logger.info(`${colors.settlement}[6/6] ✓ Pending actions: ${count}`);

      return count;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Handle provable context errors gracefully (common during settlement)
      if (errorMsg.includes("can't be run outside of a checked computation") ||
          errorMsg.includes("toString() was called on a variable field element") ||
          errorMsg.includes("Unconstrained.get()")) {
        logger.warn(`${colors.settlement}[getPendingActionsCount] Transient OffchainState error (likely during active settlement): ${errorMsg}`);
        return 0;
      }

      logger.error(`${colors.settlement}getPendingActionsCount failed: ${error}`);
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

      logger.info(`${colors.settlement}Generating settlement proof (this takes ~5-6 minutes)...`);
      const startTime = Date.now();

      // Get global zkApp to create settlement proof
      const zk = getGlobalZkApp();

      // Create settlement proof from zkApp's offchainState
      // Note: This is a compute-intensive operation
      // May throw "can't be run outside of a checked computation" but recovers internally
      let proof;
      try {
        proof = await zk.offchainState.createSettlementProof();
      } catch (error) {
        logger.warn(`${colors.settlement}Settlement proof warning (non-fatal): ${error}`);
        proof = await zk.offchainState.createSettlementProof();
      }

      const proofDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`${colors.settlement}✓ Settlement proof generated in ${proofDuration}s`);

      // Submit proof to contract with retry on sequencer load, giving locked
      // trades a better chance to progress to a settled state.
      logger.info(`${colors.settlement}Submitting settlement proof...`);

      const maxRetryMs = 5 * 60_000; // 5 minutes
      const retryIntervalMs = 20_000; // 20 seconds
      const sendStart = Date.now();
      let attempt = 0;
      let lastError: unknown = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        attempt += 1;

        try {
          // Fetch latest state with retry before each attempt
          await fetchAccountWithRetry({ publicKey: config.mina.poolAddress });
          await fetchAccountWithRetry({ publicKey: config.operator.publicKey });

          const txn = await Mina.transaction(
            { sender: config.operator.publicKey, fee: 1e9 },
            async () => {
              await zk.settle(proof);
            }
          );

          await txn.prove();
          const sentTx = await txn.sign([config.operator.privateKey]).send();

          if (!sentTx || !sentTx.hash) {
            throw new Error("Settlement transaction failed: no hash returned");
          }

          logger.info(
            `${colors.settlement}✓ Settlement transaction sent (attempt ${attempt}): ${sentTx.hash}`,
          );

          // Wait for confirmation (Zeko L2 doesn't support .wait() GraphQL queries)
          try {
            await sentTx.wait({ maxAttempts: 3, interval: 5000 });
          } catch (error) {
            logger.warn(`${colors.settlement}Wait confirmation warning (non-fatal): ${error}`);
          }

          const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
          logger.info(`${colors.settlement}✓✓ Settlement complete in ${totalDuration}s`);
          break;
        } catch (error: any) {
          lastError = error;
          const msg =
            error instanceof Error ? error.message : String(error);

          const isSequencerLoad =
            msg.includes("Sequencer is under the load");

          const elapsed = Date.now() - sendStart;
          if (!isSequencerLoad || elapsed >= maxRetryMs) {
            throw lastError;
          }

          logger.warn(
            `${colors.settlement}[SettlementWorker] Sequencer under load while submitting settlement (attempt ${attempt}); ` +
              `retrying in ${retryIntervalMs / 1000}s...`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
        }
      }
    } catch (error) {
      logger.error(`${colors.settlement}Settlement failed: ${error}`);
    }
  }
}

/**
 * Create and export singleton settlement worker
 * Started from main coordinator
 */
export const settlementWorker = new SettlementWorker();
