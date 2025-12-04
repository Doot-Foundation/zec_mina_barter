import { Mina, fetchAccount } from "o1js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  loadContracts,
  compileContracts,
  createContractInstance,
  isContractsCompiled,
} from "./contract-loader.js";

/**
 * Simplified Mina client for settlement service
 * Only needs to read state and submit settlement proofs
 */
export class MinaClient {
  private network: any = null;
  private zkApp: any = null;

  /**
   * Initialize network connection
   */
  async initialize() {
    logger.info("Initializing Mina network connection...");

    // Setup network
    this.network = Mina.Network({
      mina: config.mina.graphqlEndpoint,
      archive: config.mina.graphqlEndpoint,
    });
    Mina.setActiveInstance(this.network);

    logger.info(`✓ Connected to ${config.mina.network}`);
  }

  /**
   * Compile contract (do once at startup)
   */
  async compile() {
    if (isContractsCompiled()) {
      logger.debug("Contracts already compiled");
      return;
    }

    await compileContracts();
  }

  /**
   * Get or create zkApp instance
   */
  async getZkApp() {
    if (this.zkApp) {
      return this.zkApp;
    }

    // Load contracts
    await loadContracts();

    // Create instance
    this.zkApp = await createContractInstance(config.mina.poolAddress);

    return this.zkApp;
  }

  /**
   * Get count of pending actions since last settlement
   */
  async getPendingActionsCount(): Promise<number> {
    try {
      // Step 1: Fetch fresh account state
      const account = await fetchAccount({
        publicKey: config.mina.poolAddress,
      });

      if (!account.account) {
        logger.warn("Account not found on-chain");
        return 0;
      }

      // Step 2: Get zkApp instance
      const zkApp = await this.getZkApp();

      // Step 3: Get fresh commitments
      const commitments = zkApp.offchainStateCommitments.get();

      // Step 4: Fetch actions since last settlement
      const actions = await Mina.fetchActions(config.mina.poolAddress, {
        fromActionState: commitments.actionState,
      });

      if ("error" in actions) {
        logger.warn(`Fetch actions error: ${actions.error.statusText}`);
        return 0;
      }

      // Step 5: Count all actions
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
   * Submit settlement proof
   */
  async submitSettlementProof(proof: any): Promise<string | null> {
    try {
      logger.info("Submitting settlement proof...");

      // Get zkApp instance
      const zkApp = await this.getZkApp();

      // Fetch latest account states (critical for fresh nonce and contract state)
      logger.debug("Fetching latest account states...");
      await fetchAccount({ publicKey: config.mina.poolAddress });
      await fetchAccount({ publicKey: config.operator.publicKey });
      logger.debug("✓ Account states fetched");

      // Create transaction with fresh nonce (1 MINA fee matches test scripts)
      logger.debug("Building settlement transaction...");
      const txn = await Mina.transaction(
        { sender: config.operator.publicKey, fee: 1e9 }, // 1 MINA (matches test scripts)
        async () => {
          await zkApp.settle(proof);
        }
      );

      // Prove and send
      logger.debug("Proving settlement transaction...");
      await txn.prove();

      logger.debug("Signing and sending...");
      const sentTx = await txn.sign([config.operator.privateKey]).send();

      if (!sentTx || !sentTx.hash) {
        throw new Error("Settlement transaction failed: no hash returned");
      }

      const txHash = sentTx.hash;
      logger.info(`✓ Settlement transaction sent: ${txHash}`);

      // Wait for confirmation
      logger.debug("Waiting for confirmation...");
      await sentTx.wait();

      logger.info(`✓ Settlement confirmed: ${txHash}`);

      return txHash;
    } catch (error) {
      logger.error(`Failed to submit settlement proof: ${error}`);
      logger.error(
        `Stack trace: ${error instanceof Error ? error.stack : "N/A"}`
      );
      // Enhanced error information for common issues
      if (error instanceof Error) {
        if (error.message.includes("Account_nonce_precondition_unsatisfied")) {
          logger.error("");
          logger.error("NONCE COLLISION DETECTED:");
          logger.error(
            "  - Another transaction was sent from operator during proof generation"
          );
          logger.error(
            "  - This is expected if operator is used by multiple services"
          );
          logger.error(
            "  - Settlement will retry on next cycle with fresh nonce"
          );
          logger.error("");
        } else if (error.message.includes("insufficient balance")) {
          logger.error("");
          logger.error("INSUFFICIENT BALANCE:");
          logger.error(
            "  - Operator needs at least 1 MINA for settlement transaction fee"
          );
          logger.error("  - Check operator balance and fund if needed");
          logger.error("");
        }
      }

      return null;
    }
  }
}

export const minaClient = new MinaClient();
