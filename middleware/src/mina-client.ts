import { Mina, PublicKey, Field } from "o1js";
import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { MinaTrade } from "./types.js";
import {
  getGlobalZkApp,
  getContractModules,
  fetchAccountWithRetry,
} from "./shared-contracts.js";

// Persistent storage for tracked trade IDs so we can recover
// across middleware restarts. This keeps coordinator behavior
// robust without needing any extra database.
const STATE_DIR = path.resolve(process.cwd(), ".state");
const TRACKED_TRADES_FILE = path.join(STATE_DIR, "tracked-trades.json");

function ensureStateDir() {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
  } catch (error) {
    logger.error(`[MinaClient] Failed to ensure state directory ${STATE_DIR}: ${error}`);
  }
}

function loadTrackedTradesFromDisk(): string[] {
  try {
    if (!fs.existsSync(TRACKED_TRADES_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(TRACKED_TRADES_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return data.filter((id) => typeof id === "string");
    }
    return [];
  } catch (error) {
    logger.warn(
      `[MinaClient] Failed to load tracked trades from ${TRACKED_TRADES_FILE}: ${error}`,
    );
    return [];
  }
}

function persistTrackedTrades(tradeIds: Set<string>) {
  try {
    ensureStateDir();
    const list = Array.from(tradeIds.values());
    fs.writeFileSync(TRACKED_TRADES_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch (error) {
    logger.warn(
      `[MinaClient] Failed to persist tracked trades to ${TRACKED_TRADES_FILE}: ${error}`,
    );
  }
}

/**
 * Client for interacting with MinaEscrowPool contract
 */
export class MinaClient {
  private network: any = null;
  private trackedTradeIds: Set<string> = new Set(); // Simple in-memory tracking

  constructor() {
    const restored = loadTrackedTradesFromDisk();
    if (restored.length > 0) {
      this.trackedTradeIds = new Set(restored);
      logger.info(
        `[MinaClient] Restored ${restored.length} tracked tradeIds from disk`,
      );
    }
  }

  /**
   * Initialize network connection
   */
  async initialize() {
    logger.info("Initializing Mina network connection...");

    // Setup network
    this.network = Mina.Network({
      mina: config.mina.graphqlEndpoint,
      archive: config.mina.graphqlEndpoint, // Some endpoints combine both
    });
    Mina.setActiveInstance(this.network);

    logger.info(`✓ Connected to ${config.mina.network}`);
  }

  /**
   * Get global zkApp instance (compiled in main thread)
   */
  async getZkApp() {
    return getGlobalZkApp();
  }

  /**
   * Normalize tradeId input (UUID string or raw Field string) into Field.
   */
  private toTradeIdField(tradeId: string): Field {
    const modules = getContractModules();
    const isUuid =
      typeof tradeId === "string" &&
      typeof modules.isValidUUID === "function" &&
      modules.isValidUUID(tradeId);

    if (isUuid && typeof modules.uuidToField === "function") {
      return modules.uuidToField(tradeId);
    }

    return Field(tradeId);
  }

  /**
   * Register a trade ID for tracking
   */
  registerTrade(tradeId: string) {
    this.trackedTradeIds.add(tradeId);
    logger.info(`[MinaClient] Registered trade for tracking: ${tradeId}`);
    persistTrackedTrades(this.trackedTradeIds);
  }

  /**
   * Unregister a trade ID (when completed/failed)
   */
  unregisterTrade(tradeId: string) {
    this.trackedTradeIds.delete(tradeId);
    logger.debug(`Unregistered trade: ${tradeId}`);
    persistTrackedTrades(this.trackedTradeIds);
  }

  /**
   * Query tracked active trades using simple .get() method
   * Only checks trades we're actively managing.
   *
   * NOTE:
   * - We intentionally delegate all OffchainState access to getTrade()
   *   so that any transient OffchainState errors (root mismatch,
   *   precondition conflicts during settlement, etc.) are handled in
   *   one place instead of duplicating logic here.
   */
  async getActiveTrades(): Promise<MinaTrade[]> {
    const trades: MinaTrade[] = [];

    logger.debug(
      `[MinaClient] getActiveTrades() over ${this.trackedTradeIds.size} tracked tradeIds`,
    );

    // Fast-path: nothing tracked yet
    if (this.trackedTradeIds.size === 0) {
      logger.info(
        "[MinaClient] getActiveTrades() result: 0 active trades (no tracked tradeIds)",
      );
      return trades;
    }
    for (const tradeId of this.trackedTradeIds) {
      try {
        const trade = await this.getTrade(tradeId);
        if (trade) {
          logger.debug(
            `[MinaClient]   <- active trade ${tradeId}: amount=${trade.amount} inTransit=${trade.inTransit}`,
          );
          trades.push(trade);
        } else {
          logger.debug(
            `[MinaClient]   <- trade ${tradeId} not active or not present in OffchainState this poll`,
          );
        }
      } catch (error) {
        logger.error(
          `[MinaClient]   !! error while querying trade ${tradeId} in getActiveTrades(): ${error}`,
        );
      }
    }

    logger.info(
      `[MinaClient] getActiveTrades() result: ${trades.length} active trades`,
    );
    return trades;
  }

  /**
   * Get specific trade by ID
   *
   * @param tradeId - Trade UUID string
   * @returns Trade data or null if not found
   */
  async getTrade(tradeId: string): Promise<MinaTrade | null> {
    try {
      // Get zkApp instance
      const zkApp = await this.getZkApp();
      // Normalize tradeId into Field for contract lookup, but
      // keep the original string as the logical trade identifier
      const tradeIdField = this.toTradeIdField(tradeId);

      // Fetch latest account state
      await fetchAccountWithRetry({ publicKey: config.mina.poolAddress });

      // Query trade from OffchainState
      const trade = await zkApp.offchainState.fields.trades.get(tradeIdField);

      // Check if trade exists
      if (!trade.isSome.toBoolean()) {
        logger.debug(
          `[MinaClient] getTrade(${tradeId}) -> not found in OffchainState (field=${tradeIdField.toString()})`,
        );
        return null;
      }

      const tradeData = trade.value;

      // Check if completed
      if (tradeData.completed.toBoolean()) {
        logger.debug(
          `[MinaClient] getTrade(${tradeId}) -> completed=true (field=${tradeIdField.toString()})`,
        );
         // Once a trade is explicitly marked completed in OffchainState,
         // we can safely stop tracking it locally.
         this.unregisterTrade(tradeId);
        return null;
      }

      // Convert to MinaTrade format. tradeId is the original UUID string
      // used throughout the middleware (for port allocation, escrowd TRADE_ID, etc),
      // while tradeIdField is the Field representation used on-chain.
      const result: MinaTrade = {
        tradeId,
        tradeIdField: tradeIdField.toString(),
        depositor: tradeData.depositor.toBase58(),
        amount: tradeData.amount.toString(),
        inTransit: tradeData.inTransit.toBoolean(),
        claimant: tradeData.claimant.toBase58(),
        refundAddress: tradeData.refundAddress.toBase58(),
        depositBlockHeight: tradeData.depositBlockHeight.toString(),
        expiryBlockHeight: tradeData.expiryBlockHeight.toString(),
      };

      logger.debug(
        `[MinaClient] getTrade(${tradeId}) -> OK amount=${result.amount} inTransit=${result.inTransit} depositor=${result.depositor}`,
      );
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const transientPatterns = [
        "root mismatch",
        "Precondition Error",
        "This function can't be run outside of a checked computation",
        "You cannot use Unconstrained.get()",
      ];
      if (transientPatterns.some((p) => msg.includes(p))) {
        // These typically happen while a settlement proof is in-flight or
        // OffchainState is updating commitments. Treat them as transient and
        // retry on the next poll instead of surfacing a hard error.
        logger.warn(
          `[MinaClient] Transient OffchainState error while querying trade ${tradeId}: ${msg}. Skipping this poll.`,
        );
      } else {
        logger.error(
          `[MinaClient] Failed to query trade ${tradeId}: ${msg}`,
        );
      }
      return null;
    }
  }

  /**
   * Lock trade on MINA side
   * Calls lockTrade() method on MinaEscrowPool
   *
   * @param tradeIdField - Trade ID as Field
   * @param claimant - ZEC seller's MINA address (who can claim)
   * @returns Transaction hash or null if failed
   */
  async lockTrade(
    tradeId: string,
    claimant: PublicKey
  ): Promise<string | null> {
    try {
      const tradeIdField = this.toTradeIdField(tradeId);
      logger.info(`Locking MINA trade: ${tradeIdField.toString()}`);

      // Get zkApp instance
      const zkApp = await this.getZkApp();

      // Fetch latest account state
      await fetchAccountWithRetry({ publicKey: config.mina.poolAddress });
      await fetchAccountWithRetry({ publicKey: config.operator.publicKey });

      // Create transaction
      const txn = await Mina.transaction(
        { sender: config.operator.publicKey, fee: 1e9 },
        async () => {
          await zkApp.lockTrade(tradeIdField, claimant);
        }
      );

      // Generate proof
      logger.debug("Generating proof for lockTrade...");
      await txn.prove();

      // Sign and send
      const signedTx = await txn.sign([config.operator.privateKey]).send();

      if (!signedTx || !signedTx.hash) {
        throw new Error("Transaction failed: no hash returned");
      }

      const txHash = signedTx.hash;
      logger.info(`✓ MINA trade locked: ${txHash}`);

      // Wait for inclusion (optional, GraphQL may not support bestChain)
      try {
        await signedTx.wait();
        logger.debug(`Transaction confirmed: ${txHash}`);
      } catch (waitError) {
        // Non-fatal on Zeko: we already have a hash and the tx was accepted.
        logger.warn(
          `[MinaClient] wait() for lockTrade(${tradeId}) failed (non-fatal): ${waitError}`,
        );
      }

      return txHash;
    } catch (error) {
      logger.error(`Failed to lock MINA trade: ${error}`);
      return null;
    }
  }

  /**
   * Emergency unlock - unlocks a locked trade
   * Used when ZEC lock fails after MINA lock succeeds
   *
   * @param tradeIdField - Trade ID as Field
   * @returns Transaction hash or null if failed
   */
  async emergencyUnlock(tradeId: string): Promise<string | null> {
    try {
      const tradeIdField = this.toTradeIdField(tradeId);
      logger.warn(`Emergency unlock MINA trade: ${tradeIdField.toString()}`);

      // Get zkApp instance
      const zkApp = await this.getZkApp();

      // Fetch latest account state
      await fetchAccountWithRetry({ publicKey: config.mina.poolAddress });
      await fetchAccountWithRetry({ publicKey: config.operator.publicKey });

      // Create transaction
      const txn = await Mina.transaction(
        { sender: config.operator.publicKey, fee: 1e9 },
        async () => {
          await zkApp.emergencyUnlock(tradeIdField);
        }
      );

      // Generate proof
      logger.debug("Generating proof for emergencyUnlock...");
      await txn.prove();

      // Sign and send
      const signedTx = await txn.sign([config.operator.privateKey]).send();

      if (!signedTx || !signedTx.hash) {
        throw new Error("Transaction failed: no hash returned");
      }

      const txHash = signedTx.hash;
      logger.warn(`✓ MINA trade emergency unlocked: ${txHash}`);

      // Wait for inclusion (optional)
      try {
        await signedTx.wait();
      } catch (waitError) {
        logger.warn(
          `[MinaClient] wait() for emergencyUnlock(${tradeId}) failed (non-fatal): ${waitError}`,
        );
      }

      return txHash;
    } catch (error) {
      logger.error(`Failed to emergency unlock MINA trade: ${error}`);
      return null;
    }
  }

  /**
   * Get contract balance
   */
  async getPoolBalance(): Promise<bigint> {
    try {
      const account = await fetchAccountWithRetry({
        publicKey: config.mina.poolAddress,
      });
      const balance = account.account?.balance.toBigInt() ?? 0n;
      return balance;
    } catch (error) {
      logger.error(`Failed to fetch pool balance: ${error}`);
      return 0n;
    }
  }
}

export const minaClient = new MinaClient();
