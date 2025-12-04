import { Mina, PublicKey, Field } from 'o1js';
import { config } from './config.js';
import { logger } from './logger.js';
import { MinaTrade } from './types.js';
import { getGlobalZkApp, getContractModules, fetchAccountWithRetry } from './shared-contracts.js';

/**
 * Client for interacting with MinaEscrowPool contract
 */
export class MinaClient {
  private network: any = null;
  private trackedTradeIds: Set<string> = new Set(); // Simple in-memory tracking

  /**
   * Initialize network connection
   */
  async initialize() {
    logger.info('Initializing Mina network connection...');

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
      typeof tradeId === 'string' &&
      typeof modules.isValidUUID === 'function' &&
      modules.isValidUUID(tradeId);

    if (isUuid && typeof modules.uuidToField === 'function') {
      return modules.uuidToField(tradeId);
    }

    return Field(tradeId);
  }

  /**
   * Register a trade ID for tracking
   */
  registerTrade(tradeId: string) {
    this.trackedTradeIds.add(tradeId);
    logger.debug(`Registered trade: ${tradeId}`);
  }

  /**
   * Unregister a trade ID (when completed/failed)
   */
  unregisterTrade(tradeId: string) {
    this.trackedTradeIds.delete(tradeId);
    logger.debug(`Unregistered trade: ${tradeId}`);
  }

  /**
   * Query tracked active trades using simple .get() method
   * Only checks trades we're actively managing
   */
  async getActiveTrades(): Promise<MinaTrade[]> {
    const trades: MinaTrade[] = [];

    for (const tradeId of this.trackedTradeIds) {
      const trade = await this.getTrade(tradeId);
      if (trade) {
        trades.push(trade);
      } else {
        // Trade completed/not found, unregister it
        this.unregisterTrade(tradeId);
      }
    }

    logger.debug(`Found ${trades.length} active tracked trades`);
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
      const tradeIdField = this.toTradeIdField(tradeId);

      // Fetch latest account state
      await fetchAccountWithRetry({ publicKey: config.mina.poolAddress });

      // Query trade from OffchainState
      const trade = await zkApp.offchainState.fields.trades.get(tradeIdField);

      // Check if trade exists
      if (!trade.isSome.toBoolean()) {
        logger.debug(`Trade not found: ${tradeIdField.toString()}`);
        return null;
      }

      const tradeData = trade.value;

      // Check if completed
      if (tradeData.completed.toBoolean()) {
        logger.debug(`Trade completed: ${tradeIdField.toString()}`);
        return null;
      }

      // Convert to MinaTrade format
      return {
        tradeId: tradeIdField.toString(),
        tradeIdField: tradeIdField.toString(),
        depositor: tradeData.depositor.toBase58(),
        amount: tradeData.amount.toString(),
        inTransit: tradeData.inTransit.toBoolean(),
        claimant: tradeData.claimant.toBase58(),
        refundAddress: tradeData.refundAddress.toBase58(),
        depositBlockHeight: tradeData.depositBlockHeight.toString(),
        expiryBlockHeight: tradeData.expiryBlockHeight.toString(),
      };
    } catch (error) {
      logger.error(`Failed to query trade: ${error}`);
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
  async lockTrade(tradeId: string, claimant: PublicKey): Promise<string | null> {
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
        { sender: config.operator.publicKey, fee: 0.1e9 },
        async () => {
          await zkApp.lockTrade(tradeIdField, claimant);
        }
      );

      // Generate proof
      logger.debug('Generating proof for lockTrade...');
      await txn.prove();

      // Sign and send
      const signedTx = await txn.sign([config.operator.privateKey]).send();

      if (!signedTx || !signedTx.hash) {
        throw new Error('Transaction failed: no hash returned');
      }

      const txHash = signedTx.hash;
      logger.info(`✓ MINA trade locked: ${txHash}`);

      // Wait for inclusion (optional)
      await signedTx.wait();
      logger.debug(`Transaction confirmed: ${txHash}`);

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
        { sender: config.operator.publicKey, fee: 0.1e9 },
        async () => {
          await zkApp.emergencyUnlock(tradeIdField);
        }
      );

      // Generate proof
      logger.debug('Generating proof for emergencyUnlock...');
      await txn.prove();

      // Sign and send
      const signedTx = await txn.sign([config.operator.privateKey]).send();

      if (!signedTx || !signedTx.hash) {
        throw new Error('Transaction failed: no hash returned');
      }

      const txHash = signedTx.hash;
      logger.warn(`✓ MINA trade emergency unlocked: ${txHash}`);

      // Wait for inclusion
      await signedTx.wait();

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
      const account = await fetchAccountWithRetry({ publicKey: config.mina.poolAddress });
      const balance = account.account?.balance.toBigInt() ?? 0n;
      return balance;
    } catch (error) {
      logger.error(`Failed to fetch pool balance: ${error}`);
      return 0n;
    }
  }
}

export const minaClient = new MinaClient();
